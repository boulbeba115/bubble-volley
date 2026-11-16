"""
Bubble Volley — procedural asset builder.

Run with Blender (4.x / 5.x):
    blender -b -P tools/build_assets.py -- src/assets/models

Generates three GLB files: slime.glb, ball.glb, beach.glb
Units: 1 Blender unit == 100 game pixels. Z is up in Blender (exported Y-up).
The camera looks along +Y, so "front" of a model is -Y.
"""
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, Matrix, noise

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "."
os.makedirs(OUT, exist_ok=True)
random.seed(7)
PI = math.pi


# ------------------------------------------------------------------ helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def M(name, hexcol, rough=0.85, metal=0.0, emit=0.0, double=False):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    nt = m.node_tree
    bsdf = next((n for n in nt.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        nt.nodes.clear()
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(bsdf.outputs[0], out.inputs[0])
    h = hexcol.lstrip("#")
    col = [srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)] + [1.0]
    bsdf.inputs["Base Color"].default_value = col
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit > 0:
        bsdf.inputs["Emission Color"].default_value = col
        bsdf.inputs["Emission Strength"].default_value = emit
    m.use_backface_culling = not double
    return m


def mk(name, bm, mats, smooth=False, parent=None, loc=(0, 0, 0), rot=(0, 0, 0),
       scale=(1, 1, 1), recalc=True):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.location, o.rotation_euler, o.scale = loc, rot, scale
    if parent:
        o.parent = parent
    return o


def empty(name, parent=None, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    o = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(o)
    o.location, o.rotation_euler, o.scale = loc, rot, scale
    if parent:
        o.parent = parent
    return o


def setmi(ret, mi):
    faces = set()
    for v in ret["verts"]:
        faces.update(v.link_faces)
    for f in faces:
        f.material_index = mi
    return faces


def T(x, y, z):
    return Matrix.Translation((x, y, z))


def S(x, y, z):
    return Matrix.Diagonal((x, y, z, 1))


def box(bm, c, s, mi=0, rot=None):
    m = T(*c) @ (rot if rot else Matrix.Identity(4)) @ S(*s)
    return setmi(bmesh.ops.create_cube(bm, size=1, matrix=m), mi)


def sphere(bm, c, r, mi=0, u=16, v=10, sc=(1, 1, 1), rot=None):
    m = T(*c) @ (rot if rot else Matrix.Identity(4)) @ S(*sc)
    return setmi(bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r, matrix=m), mi)


def ico(bm, c, r, mi=0, sub=2, sc=(1, 1, 1)):
    m = T(*c) @ S(*sc)
    return setmi(bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r, matrix=m), mi)


def tube(bm, pts, radii, segs=8, cap=True, mi=0):
    pts = [Vector(p) for p in pts]
    n = len(pts)
    if not isinstance(radii, (list, tuple)):
        radii = [radii] * n
    t0 = (pts[1] - pts[0]).normalized()
    up = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    nrm = t0.cross(up).normalized()
    rings = []
    for i in range(n):
        if i == 0:
            t = t0
        elif i == n - 1:
            t = (pts[i] - pts[i - 1]).normalized()
        else:
            t = (pts[i + 1] - pts[i - 1]).normalized()
        nrm = (nrm - t * nrm.dot(t)).normalized()
        b = t.cross(nrm)
        rings.append([
            bm.verts.new(pts[i] + (nrm * math.cos(2 * PI * k / segs) + b * math.sin(2 * PI * k / segs)) * radii[i])
            for k in range(segs)])
    for i in range(n - 1):
        for k in range(segs):
            f = bm.faces.new((rings[i][k], rings[i][(k + 1) % segs], rings[i + 1][(k + 1) % segs], rings[i + 1][k]))
            f.material_index = mi
    if cap:
        bm.faces.new(list(reversed(rings[0]))).material_index = mi
        bm.faces.new(rings[-1]).material_index = mi


def export(name):
    path = os.path.join(OUT, name)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_apply=True,
                              export_yup=True, export_animations=False)
    print("EXPORTED", path, os.path.getsize(path), "bytes")


# ------------------------------------------------------------------ slime
H_BLOB = 0.82


def blob_r(z, R=0.8, n=2.5):
    """Gumdrop profile: a soft, slightly square dome that tucks in at the base."""
    z = max(0.0, min(H_BLOB, z))
    r = R * (max(0.0, 1 - (z / H_BLOB) ** n)) ** (1 / n)
    if z < 0.12:
        r *= 0.86 + 0.14 * math.sin(PI / 2 * z / 0.12)
    return r


def surf(phi, z, push=0.0):
    r = blob_r(z) + push
    return Vector((r * math.sin(phi), -r * math.cos(phi), z))


def build_slime():
    reset()
    root = empty("Slime")
    body_m = M("Body", "#3ea6ff", rough=0.2)
    bm = bmesh.new()
    K, SEG = 20, 48
    rings = []
    for i in range(K):
        th = (PI / 2) * i / K
        z = H_BLOB * math.sin(th) ** 0.8
        r = blob_r(z)
        rings.append([bm.verts.new((r * math.cos(2 * PI * k / SEG), r * math.sin(2 * PI * k / SEG), z)) for k in range(SEG)])
    top = bm.verts.new((0, 0, H_BLOB))
    bot = bm.verts.new((0, 0, 0))
    for i in range(K - 1):
        for k in range(SEG):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % SEG], rings[i + 1][(k + 1) % SEG], rings[i + 1][k]))
    for k in range(SEG):
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % SEG], top))
        bm.faces.new((rings[0][(k + 1) % SEG], rings[0][k], bot))
    mk("Body", bm, [body_m], smooth=True, parent=root)

    white = M("EyeWhite", "#ffffff", rough=0.12)
    dark = M("Pupil", "#131a30", rough=0.08)
    glint = M("Glint", "#ffffff", rough=0.1, emit=1.5)
    for side, sx in (("L", -1), ("R", 1)):
        c = surf(sx * 0.34, 0.47)
        c.x *= 0.93
        c.y *= 0.93
        bm = bmesh.new()
        sphere(bm, (0, 0, 0), 0.19, u=28, v=16)
        eye = mk("Eye" + side, bm, [white], smooth=True, parent=root, loc=c)
        bm = bmesh.new()
        sphere(bm, (0, 0, 0), 0.118, u=24, v=14)
        sphere(bm, (0.042, -0.094, 0.05), 0.036, mi=1, u=10, v=6)
        sphere(bm, (-0.036, -0.1, -0.036), 0.017, mi=1, u=8, v=6)
        mk("Pupil" + side, bm, [dark, glint], smooth=True, parent=eye, loc=(0, -0.105, 0))

    bm = bmesh.new()
    for sx in (-1, 1):
        sphere(bm, surf(sx * 0.7, 0.31, -0.055), 0.09, u=14, v=8)
    mk("Cheeks", bm, [M("Cheek", "#ff8fb0", rough=0.6)], smooth=True, parent=root)

    pc = surf(0, 0.29)
    pts = []
    for i in range(13):
        a = math.radians(205 + (335 - 205) * i / 12)
        q = pc + 0.115 * Vector((math.cos(a), 0, math.sin(a)))
        pts.append(surf(math.atan2(q.x, -q.y), q.z + 0.07, 0.008))
    bm = bmesh.new()
    tube(bm, pts, [0.011 + 0.016 * math.sin(PI * i / 12) for i in range(13)], segs=6)
    mk("Mouth", bm, [M("MouthDark", "#1a2238", rough=0.5)], smooth=True, parent=root)

    # glossy highlight patches that make the body read as wet jelly
    bm = bmesh.new()
    for (p0, z0, dp, dz) in ((-0.68, 0.6, 0.2, 0.085), (-0.36, 0.735, 0.07, 0.028)):
        c = bm.verts.new(surf(p0, z0, 0.008))
        ring = [bm.verts.new(surf(p0 + dp * math.cos(2 * PI * k / 18), z0 + dz * math.sin(2 * PI * k / 18), 0.008)) for k in range(18)]
        for k in range(18):
            bm.faces.new((c, ring[k], ring[(k + 1) % 18]))
    mk("Shine", bm, [M("Shine", "#ffffff", rough=0.3, emit=1.0, double=True)], smooth=True, parent=root, recalc=False)

    # accessory 1: a little jelly curl on top
    nub = empty("AccNub", parent=root, loc=(0, 0, 0.79))
    bm = bmesh.new()
    tube(bm, [(0, 0, -0.04), (0.02, 0, 0.08), (0.08, 0, 0.16), (0.16, 0, 0.175)], [0.12, 0.09, 0.062, 0.042], segs=12)
    sphere(bm, (0.175, 0, 0.175), 0.046, u=12, v=8)
    mk("NubMesh", bm, [body_m], smooth=True, parent=nub)

    # accessory 2: leaf sprout
    sp = empty("AccSprout", parent=root, loc=(0, 0, H_BLOB - 0.03))
    bm = bmesh.new()
    tube(bm, [(0, 0, 0), (0.01, 0, 0.1), (0.04, 0, 0.2), (0.05, 0, 0.27)], [0.035, 0.03, 0.026, 0.022], segs=8)
    sphere(bm, (0.21, 0, 0.33), 1, mi=1, u=14, v=8, sc=(0.18, 0.085, 0.03), rot=Matrix.Rotation(-0.45, 4, "Y"))
    sphere(bm, (-0.09, 0, 0.36), 1, mi=1, u=14, v=8, sc=(0.15, 0.075, 0.03), rot=Matrix.Rotation(0.6, 4, "Y"))
    mk("SproutMesh", bm, [M("Stem", "#3f9b4b", rough=0.6), M("Leaf", "#6fdc6a", rough=0.5)], smooth=True, parent=sp)
    export("slime.glb")


# ------------------------------------------------------------------ ball
def build_ball():
    reset()
    r = 0.24
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=36, v_segments=20, radius=r)
    wedge = [0, 3, 1, 3, 2, 3]
    for f in bm.faces:
        c = f.calc_center_median()
        if abs(c.z) / r > 0.94:
            f.material_index = 3
        else:
            f.material_index = wedge[int((math.atan2(c.y, c.x) + PI) / (2 * PI) * 6) % 6]
    mats = [M("BallRed", "#ff4d5e", 0.3), M("BallYellow", "#ffd23f", 0.3),
            M("BallBlue", "#2f9bff", 0.3), M("BallWhite", "#ffffff", 0.3)]
    mk("Ball", bm, mats, smooth=True)
    export("ball.glb")


# ------------------------------------------------------------------ beach
def shore(x):
    return 5.2 + 0.5 * math.sin(x * 0.35) + 0.25 * math.sin(x * 0.9 + 1.3)


def sand_h(x, y):
    s = shore(x)
    h = 0.0
    if y > s - 1.5:
        t = y - (s - 1.5)
        h = -0.08 * t - 0.02 * t * t
    d = min(1.0, max(0.0, abs(x) - 6.5) / 4.0)
    fy = 1.0 if y > -2.5 else max(0.0, 1 - (-2.5 - y) / 3)
    fs = min(1.0, max(0.0, (s - 1.5 - y) / 2.0))
    n = noise.noise(Vector((x * 0.22, y * 0.22, 0.0)))
    h += d * fy * fs * 0.3 * (1 + n)
    return h


def palm(idx, x, y, height, lean_x, lean_y):
    trunk_m = M("Trunk", "#8a5a3b", 0.9)
    leaf_a = M("PalmLeafA", "#2fa84f", 0.7, double=True)
    leaf_b = M("PalmLeafB", "#49c35c", 0.7, double=True)
    root = empty("Palm%d" % idx, loc=(x, y, sand_h(x, y) - 0.1))
    bm = bmesh.new()
    n = 14
    pts, rad = [], []
    for i in range(n):
        t = i / (n - 1)
        pts.append((lean_x * t * t, lean_y * t * t, height * t))
        rad.append((0.25 - 0.12 * t) * (1.13 if i % 2 else 0.95))
    tube(bm, pts, rad, segs=8)
    mk("PalmTrunk%d" % idx, bm, [trunk_m], parent=root)
    crown = empty("PalmCrown%d" % idx, parent=root, loc=(lean_x, lean_y, height))
    bm = bmesh.new()
    k = 9
    for f in range(k):
        ang = 2 * PI * f / k + random.uniform(-0.2, 0.2)
        L = random.uniform(2.1, 2.8)
        droop = random.uniform(1.0, 1.5)
        d = Vector((math.cos(ang), math.sin(ang), 0))
        side = Vector((-d.y, d.x, 0))
        segs = 7
        rows = []
        for s in range(segs + 1):
            u = s / segs
            c = d * (L * u) + Vector((0, 0, 0.6 * math.sin(PI * min(u * 1.1, 1)) - droop * u * u))
            w = 0.38 * (max(0.0, math.sin(PI * (0.08 + 0.92 * u))) ** 0.7) * (1 - u * 0.3)
            dz = Vector((0, 0, 0.3 * w))
            rows.append((bm.verts.new(c + side * w - dz), bm.verts.new(c + Vector((0, 0, 0.05))),
                         bm.verts.new(c - side * w - dz)))
        for s in range(segs):
            a, b = rows[s], rows[s + 1]
            bm.faces.new((a[0], a[1], b[1], b[0])).material_index = f % 2
            bm.faces.new((a[1], a[2], b[2], b[1])).material_index = f % 2
    mk("PalmLeaves%d" % idx, bm, [leaf_a, leaf_b], parent=crown, recalc=False)
    bm = bmesh.new()
    for i in range(3):
        a = i * 2.1 + idx
        sphere(bm, (0.17 * math.cos(a), 0.17 * math.sin(a), -0.16), 0.13, u=10, v=6)
    mk("Coconuts%d" % idx, bm, [M("Coconut", "#5b3a26", 0.8)], smooth=True, parent=crown)


def rock(name, loc, scale, seed):
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1)
    for v in bm.verts:
        v.co *= rnd.uniform(0.78, 1.15)
    mk(name, bm, [M("Rock", "#7f8a99", 0.95)], loc=loc, scale=scale, rot=(0, 0, rnd.uniform(0, 6)))


def build_beach():
    reset()
    # ---- sand
    bm = bmesh.new()
    xs = [-48 + 0.75 * i for i in range(129)]
    ys = [-18 + 0.6 * j for j in range(60)]
    grid = [[bm.verts.new((x, y, sand_h(x, y))) for y in ys] for x in xs]
    uv = bm.loops.layers.uv.new("UVMap")
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            f = bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
            for l in f.loops:
                l[uv].uv = (l.vert.co.x * 0.25, l.vert.co.y * 0.25)
    mk("Sand", bm, [M("Sand", "#f0d59a", 0.95)], smooth=True, recalc=False)

    # ---- court lines
    line = M("Line", "#ffffff", 0.8)
    bm = bmesh.new()
    cw, cd, lw = 4.6, 1.8, 0.07
    for y in (-cd, cd):
        box(bm, (0, y, 0.008), (cw * 2 + lw, lw, 0.016))
    for x in (-cw, cw):
        box(bm, (x, 0, 0.008), (lw, cd * 2, 0.016))
    box(bm, (0, 0, 0.008), (lw * 0.7, cd * 2, 0.016))
    mk("CourtLines", bm, [line])

    # ---- net
    post_m = M("Post", "#f4f6fb", 0.4, metal=0.2)
    tape_m = M("NetTape", "#ffffff", 0.7)
    rope_m = M("NetRope", "#e9eef7", 0.8)
    pad_m = M("PostPad", "#ff7a59", 0.6)
    bm = bmesh.new()
    for y in (-1.98, 1.98):
        tube(bm, [(0, y, -0.2), (0, y, 1.80)], 0.06, segs=12)
        sphere(bm, (0, y, 1.82), 0.085, u=12, v=8)
        tube(bm, [(0, y, 0.0), (0, y, 0.75)], 0.095, segs=12, mi=1)
    mk("NetPosts", bm, [post_m, pad_m], smooth=True)
    bm = bmesh.new()
    y0, y1, z0, z1 = -1.93, 1.93, 0.06, 1.62
    ny, nz = 28, 12
    for i in range(ny + 1):
        y = y0 + (y1 - y0) * i / ny
        tube(bm, [(0, y, z0), (0, y, z1)], 0.011, segs=4, cap=False)
    for j in range(nz + 1):
        z = z0 + (z1 - z0) * j / nz
        tube(bm, [(0, y0, z), (0, y1, z)], 0.011, segs=4, cap=False)
    box(bm, (0, 0, 1.65), (0.05, y1 - y0, 0.07), mi=1)
    box(bm, (0, 0, 0.05), (0.035, y1 - y0, 0.04), mi=1)
    mk("NetMesh", bm, [rope_m, tape_m])

    # ---- corner flags
    pole_m = M("Bamboo", "#d8b46a", 0.7)
    for i, (x, y, h) in enumerate(((-4.6, -1.8, 1.0), (4.6, -1.8, 1.0), (-4.6, 1.8, 1.7), (4.6, 1.8, 1.7))):
        bm = bmesh.new()
        tube(bm, [(x, y, -0.2), (x, y, h)], 0.035, segs=8)
        sphere(bm, (x, y, h), 0.05, u=8, v=6)
        mk("FlagPole%d" % i, bm, [pole_m], smooth=True)
        bm = bmesh.new()
        d = -1 if x < 0 else 1
        vs = [bm.verts.new(p) for p in ((0, 0, 0), (0, 0, -0.32), (d * 0.5, 0, -0.16))]
        bm.faces.new(vs)
        fm = M("FlagBlue", "#3ea6ff", 0.6, double=True) if x < 0 else M("FlagRed", "#ff5b7a", 0.6, double=True)
        mk("Flag%d" % i, bm, [fm], loc=(x, y, h - 0.04), recalc=False)

    # ---- palms
    palm(0, -6.6, 3.0, 5.4, 1.2, -0.3)
    palm(1, 7.0, 2.7, 5.0, -1.0, -0.2)
    palm(2, -10.5, 1.4, 6.2, 1.5, 0.4)
    palm(3, 10.8, 3.4, 5.8, -0.6, 0.5)
    palm(4, 3.4, 3.9, 4.3, 0.7, 0.2)
    palm(5, -15.5, 3.0, 5.2, -0.8, 0.2)
    palm(6, 15.8, 1.8, 6.0, 0.9, 0.1)

    # ---- rocks
    rock("Rock0", (-9.0, 5.4, 0.0), (1.3, 1.0, 0.9), 1)
    rock("Rock1", (-7.9, 5.9, -0.1), (0.7, 0.6, 0.5), 2)
    rock("Rock2", (8.6, 5.9, 0.0), (1.1, 0.9, 0.8), 3)
    rock("Rock3", (-2.6, 8.5, -0.2), (0.9, 0.8, 0.55), 4)
    rock("Rock4", (13.0, 8.0, -0.1), (1.8, 1.3, 1.2), 5)
    rock("Rock5", (5.2, 3.6, 0.0), (0.4, 0.35, 0.3), 6)
    rock("Rock6", (-19.0, 7.0, 0.0), (2.2, 1.6, 1.5), 7)

    # ---- starfish + shells
    bm = bmesh.new()
    for (x, y, rz, sc) in ((-5.7, -1.2, 0.3, 1.0), (6.2, 0.7, 1.1, 0.8), (2.4, -2.05, 2.0, 0.7), (-2.9, 2.6, 0.7, 0.9)):
        c = bm.verts.new((x, y, 0.07 * sc))
        ring = []
        for k in range(10):
            a = rz + k * PI / 5
            r = (0.24 if k % 2 == 0 else 0.095) * sc
            ring.append(bm.verts.new((x + r * math.cos(a), y + r * math.sin(a), 0.012)))
        for k in range(10):
            bm.faces.new((c, ring[k], ring[(k + 1) % 10]))
    mk("Starfish", bm, [M("Starfish", "#ff7b54", 0.7)], recalc=False)
    bm = bmesh.new()
    for (x, y, r) in ((-4.9, -2.0, 0.07), (5.3, -1.5, 0.06), (0.9, 2.4, 0.07), (-1.6, -2.15, 0.05), (3.9, 2.3, 0.06), (6.8, -0.6, 0.08)):
        sphere(bm, (x, y, 0.0), r, u=8, v=6, sc=(1.2, 1, 0.7))
    mk("Shells", bm, [M("Shell", "#fff1e0", 0.4)], smooth=True)

    # ---- umbrella + towel
    um = empty("Umbrella", loc=(-8.2, 2.3, 0), rot=(0.12, -0.14, 0))
    bm = bmesh.new()
    tube(bm, [(0, 0, -0.2), (0, 0, 2.35)], 0.035, segs=8)
    sphere(bm, (0, 0, 2.42), 0.06, u=8, v=6)
    mk("UmbrellaPole", bm, [M("PoleWhite", "#f1f1f1", 0.5)], smooth=True, parent=um)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=10, radius1=1.55, radius2=0.04, depth=0.55,
                          matrix=T(0, 0, 2.12))
    for f in bm.faces:
        c = f.calc_center_median()
        f.material_index = int((math.atan2(c.y, c.x) + PI) / (2 * PI) * 10 + 0.001) % 2
    mk("UmbrellaTop", bm, [M("UmbA", "#ff5b5b", 0.7, double=True), M("UmbB", "#fff6e6", 0.7, double=True)],
       parent=um, recalc=False)
    bm = bmesh.new()
    for i in range(6):
        box(bm, (-0.675 + 0.27 * i, 0, 0.012), (0.27, 0.85, 0.024), mi=i % 2)
    mk("Towel", bm, [M("TowelA", "#38c6d9", 0.9), M("TowelB", "#fff6e6", 0.9)], loc=(-7.3, 1.2, 0), rot=(0, 0, 0.35))

    # ---- surfboards
    for i, (x, y, rz, col) in enumerate(((8.3, 1.9, 0.3, "#2ed3c3"), (9.0, 2.2, -0.2, "#ff8a5c"))):
        bm = bmesh.new()
        fs = sphere(bm, (0, 0, 0), 1, u=16, v=12, sc=(0.3, 0.045, 1.2))
        for f in fs:
            if abs(f.calc_center_median().x) < 0.05:
                f.material_index = 1
        mk("Surfboard%d" % i, bm, [M("Board%d" % i, col, 0.3), M("BoardStripe", "#ffffff", 0.3)], smooth=True,
           loc=(x, y, 0.95), rot=(0.2, 0.08 * (1 if i else -1), rz))

    # ---- umpire chair
    wood = M("Wood", "#c9935a", 0.8)
    bm = bmesh.new()
    for sx in (-1, 1):
        for sy in (-1, 1):
            tube(bm, [(sx * 0.5, sy * 0.4, -0.1), (sx * 0.32, sy * 0.27, 1.9)], 0.045, segs=6)
    for i in range(4):
        t = (0.35 + 0.4 * i) / 1.9
        w = 0.5 + (0.32 - 0.5) * t
        yy = -(0.4 + (0.27 - 0.4) * t)
        box(bm, (0, yy, 0.35 + 0.4 * i), (w * 2, 0.05, 0.05))
    box(bm, (0, 0, 1.93), (0.8, 0.7, 0.07))
    box(bm, (0, 0.31, 2.3), (0.8, 0.06, 0.7))
    box(bm, (0, -0.02, 1.99), (0.7, 0.58, 0.06), mi=1)
    mk("UmpireChair", bm, [wood, M("Cushion", "#ff5b5b", 0.8)], loc=(0, 3.0, 0))

    # ---- clouds
    cm = M("Cloud", "#ffffff", 1.0, emit=0.35)
    spots = [(-34, 70, 17, 5.0), (-10, 85, 22, 6.0), (16, 75, 15, 4.5), (40, 90, 21, 6.5),
             (-55, 95, 26, 7.0), (62, 80, 14, 5.0), (2, 100, 30, 6.0)]
    for i, (x, y, z, sc) in enumerate(spots):
        bm = bmesh.new()
        for k in range(5):
            r = random.uniform(0.7, 1.25) * (1.0 if k in (1, 2, 3) else 0.75)
            ico(bm, ((k - 2) * 0.95 + random.uniform(-0.2, 0.2), random.uniform(-0.3, 0.3), random.uniform(0, 0.3)), r,
                sc=(1, 0.8, 0.62))
        mk("Cloud%d" % i, bm, [cm], smooth=True, loc=(x, y, z), scale=(sc, sc, sc))

    # ---- far islands
    im = M("IslandGreen", "#4fae6a", 1.0)
    for i, (x, y, sx, sy, sz, seed) in enumerate(((-36, 78, 13, 7, 4.2, 11), (-22, 82, 7, 5, 2.4, 12), (38, 92, 17, 8, 5.5, 13))):
        rnd = random.Random(seed)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1)
        for v in bm.verts:
            v.co *= rnd.uniform(0.85, 1.12)
        mk("Island%d" % i, bm, [im], loc=(x, y, -0.4), scale=(sx, sy, sz))

    # ---- sailboat
    boat = empty("Boat", loc=(-11, 26, -0.12))
    bm = bmesh.new()
    sphere(bm, (0, 0, 0.15), 1, u=12, v=8, sc=(1.5, 0.45, 0.4))
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.32], context="VERTS")
    es = [e for e in bm.edges if e.is_boundary]
    bmesh.ops.holes_fill(bm, edges=es, sides=0)
    tube(bm, [(0.1, 0, 0.3), (0.1, 0, 3.0)], 0.035, segs=6, mi=1)
    mk("BoatHull", bm, [M("Hull", "#ff6b57", 0.6), M("Mast", "#f1f1f1", 0.6)], parent=boat)
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(p) for p in ((0.17, 0, 0.5), (0.17, 0, 2.9), (1.35, 0, 0.5))])
    bm.faces.new([bm.verts.new(p) for p in ((0.03, 0, 0.6), (0.03, 0, 2.6), (-0.95, 0, 0.6))])
    mk("BoatSail", bm, [M("Sail", "#ffffff", 0.9, emit=0.15, double=True)], parent=boat, recalc=False)

    # ---- buoys
    for i, (x, y) in enumerate(((5.5, 11.0), (-14.0, 14.0))):
        bm = bmesh.new()
        sphere(bm, (0, 0, 0.05), 0.3, u=12, v=8)
        bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.2, radius2=0.03, depth=0.5,
                              matrix=T(0, 0, 0.5))
        fs = [f for f in bm.faces if f.calc_center_median().z > 0.3]
        for f in fs:
            f.material_index = 1
        mk("Buoy%d" % i, bm, [M("BuoyRed", "#ff4d4d", 0.5), M("BuoyWhite", "#ffffff", 0.5)], loc=(x, y, -0.12))

    export("beach.glb")


build_slime()
build_ball()
build_beach()
print("ALL ASSETS BUILT")
