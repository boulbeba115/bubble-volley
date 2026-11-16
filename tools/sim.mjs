// Headless balance check: plays AI vs AI matches and prints results.
//   node tools/sim.mjs
import { Match } from '../src/game/match.js';
import { createAI, aiInput } from '../src/game/ai.js';
import { DIFFICULTY, FIXED_DT } from '../src/config.js';

function play(a, b, target = 7) {
  const m = new Match({ target });
  const ais = [createAI(0, DIFFICULTY[a]), createAI(1, DIFFICULTY[b])];
  m.start(0, 0.5);
  let steps = 0;
  while (m.phase !== 'over' && steps < 120 * 60 * 20) {
    m.step([aiInput(ais[0], m.world, FIXED_DT), aiInput(ais[1], m.world, FIXED_DT)]);
    steps++;
  }
  return { score: m.score.slice(), secs: steps / 120, stats: m.stats, done: m.phase === 'over' };
}

for (const [a, b] of [['easy', 'easy'], ['medium', 'medium'], ['hard', 'hard'], ['easy', 'hard'], ['medium', 'hard'], ['easy', 'medium']]) {
  let wins = [0, 0], secs = 0, longest = 0, hits = 0, rallies = 0, unfinished = 0;
  const N = 20;
  for (let i = 0; i < N; i++) {
    const r = play(a, b);
    if (!r.done) unfinished++;
    wins[r.score[0] > r.score[1] ? 0 : 1]++;
    secs += r.secs; longest = Math.max(longest, r.stats.longestRally);
    hits += r.stats.hits[0] + r.stats.hits[1]; rallies += r.stats.rallies;
  }
  console.log(`${a} vs ${b}: wins ${wins[0]}-${wins[1]}  avg ${(secs / N).toFixed(0)}s  hits/rally ${(hits / rallies).toFixed(1)}  longest ${longest}  unfinished ${unfinished}`);
}
