'use strict';

/**
 * 道具交接执行表（buildHandoffSchedule / analyzeScene.handoffSchedule）
 * 引擎用例：
 *  - 按列表顺序贪心排程：沿用起始时窗与最短持续，取不早于双方上一项已排
 *    结束时刻的最早可行起点；
 *  - 共用表演者不重叠（结束与下一项开始同刻允许），不共用表演者并行；
 *  - 多段时窗中选最早可行段；
 *  - 无可行时窗 infeasible、有时窗但被前项占用 conflict、涉及未完成交接
 *    参与者的后续项 blocked，并继续向参与者传递；
 *  - 未完成项不阻塞与其不共用表演者的项；
 *  - valid=false（同人/表演者缺失）按无可行时窗处理；
 *  - analyzeScene 装配及旧场景（无 handoffs）兼容。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/core.js');

const T = 12;

function approx(actual, expected, tol = 1e-7, label) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label || '值'} 期望 ${expected}，实际 ${actual}`
  );
}

// 甲：x=10t 向右；乙：x=120-10t 向左（y 恒为 50）
function crossPerformers() {
  return [
    { id: 'a', name: '甲', radius: 0, keys: [{ t: 0, x: 0, y: 50 }, { t: 12, x: 120, y: 50 }] },
    { id: 'b', name: '乙', radius: 0, keys: [{ t: 0, x: 120, y: 50 }, { t: 12, x: 0, y: 50 }] }
  ];
}

// 甲、乙圆心同时在 (40,80)×(40,60) 内且间距≤40 的区间为 [4,8]
const RECT = { x: 40, y: 40, width: 40, height: 20 };
function hOver(over) {
  return Object.assign({ aId: 'a', bId: 'b' }, RECT, { reach: 40, minDuration: 1.5 }, over || {});
}

function scheduleOf(scene) {
  return core.analyzeScene(scene).handoffSchedule;
}

test('执行表：单项按时窗最早起点排入，end=start+d', () => {
  const sched = scheduleOf({ duration: T, performers: crossPerformers(), handoffs: [hOver({ id: 'h' })] });
  assert.equal(sched.length, 1);
  assert.deepEqual(
    Object.keys(sched[0]).sort(),
    ['aId', 'aName', 'bId', 'bName', 'earliestStart', 'end', 'handoffId',
      'index', 'minDuration', 'start', 'status']
  );
  assert.equal(sched[0].status, 'scheduled');
  approx(sched[0].start, 4);
  approx(sched[0].end, 5.5);
  approx(sched[0].earliestStart, 0);
  assert.equal(sched[0].index, 0);
  assert.equal(sched[0].handoffId, 'h');
  assert.equal(sched[0].aName, '甲');
  assert.equal(sched[0].bName, '乙');
});

test('执行表：共用表演者串行——第二项起点不早于第一项结束（首尾相接）', () => {
  // h1 时窗 [4,6.5] d=1.5 -> 排 4–5.5；h2 同时窗 d=1 -> earliest=5.5 -> 排 5.5–6.5
  const sched = scheduleOf({
    duration: T,
    performers: crossPerformers(),
    handoffs: [
      hOver({ id: 'h1' }),
      hOver({ id: 'h2', minDuration: 1 })
    ]
  });
  assert.equal(sched[0].status, 'scheduled');
  assert.equal(sched[1].status, 'scheduled');
  approx(sched[1].start, 5.5, 1e-9, '第二项起点=第一项结束（同刻允许）');
  approx(sched[1].end, 6.5);
  approx(sched[1].earliestStart, 5.5);
});

test('执行表：不共用表演者的交接并行（互不约束，各自取时窗最早起点）', () => {
  const performers = crossPerformers().concat([
    { id: 'c', name: '丙', radius: 0, keys: [{ t: 0, x: 300, y: 50 }] },
    { id: 'd', name: '丁', radius: 0, keys: [{ t: 0, x: 310, y: 50 }] }
  ]);
  const sched = scheduleOf({
    duration: T,
    performers: performers,
    handoffs: [
      hOver({ id: 'h1' }),                                  // 甲×乙 4–5.5
      { id: 'h2', aId: 'c', bId: 'd', x: 290, y: 40, width: 40, height: 20,
        reach: 40, minDuration: 2 }                         // 丙×丁 全程在区 -> 0–2
    ]
  });
  assert.equal(sched[0].status, 'scheduled');
  assert.equal(sched[1].status, 'scheduled');
  approx(sched[0].start, 4);
  approx(sched[1].start, 0, 1e-9, '不共用表演者：并行排在 0');
  approx(sched[1].end, 2);
});

test('执行表：只共用一方也需串行，且另一方的更早结束不放宽约束', () => {
  const performers = crossPerformers().concat([
    { id: 'c', name: '丙', radius: 0, keys: [{ t: 0, x: 0, y: 50 }, { t: 12, x: 120, y: 50 }] }
  ]);
  // h1 甲×乙 4–5.5；h2 甲×丙（与甲乙同一区间几何，甲 x=10t、丙同甲 ->
  // 间距 0 恒满足）时窗 [4,6.5]，d=1：受甲占用 earliest=5.5 -> 5.5–6.5
  const sched = scheduleOf({
    duration: T,
    performers: performers,
    handoffs: [
      hOver({ id: 'h1' }),
      hOver({ id: 'h2', aId: 'a', bId: 'c' })
    ]
  });
  assert.equal(sched[1].status, 'scheduled');
  approx(sched[1].start, 5.5);
  approx(sched[1].end, 7, 1e-9);
});

test('执行表：多段时窗中最早段被占用时顺延到下一段可行时窗', () => {
  // 甲往返（x=20t t≤6、x=240-20t t>6），乙静止 (60,50)：
  // 可交接区间 [2,4]、[8,10]，d=1 -> 时窗 [2,3]、[8,9]
  const performers = [
    { id: 'a', radius: 0, keys: [
      { t: 0, x: 0, y: 50 }, { t: 6, x: 120, y: 50 }, { t: 12, x: 0, y: 50 }
    ] },
    { id: 'b', radius: 0, keys: [{ t: 0, x: 60, y: 50 }] }
  ];
  const base = { aId: 'a', bId: 'b', x: 40, y: 40, width: 40, height: 20, reach: 30, minDuration: 1 };
  // h1 排 2–3；h2 earliest=3：第一段时窗 [2,3] 最晚起点 3，同刻相接允许
  // -> 可排 3–4；h3 earliest=4：第一段不可用，顺延第二段时窗 [8,9] -> 8–9
  const sched = scheduleOf({
    duration: T,
    performers: performers,
    handoffs: [
      Object.assign({ id: 'h1' }, base),
      Object.assign({ id: 'h2' }, base),
      Object.assign({ id: 'h3' }, base)
    ]
  });
  assert.equal(sched[0].status, 'scheduled');
  approx(sched[0].start, 2);
  assert.equal(sched[1].status, 'scheduled');
  approx(sched[1].start, 3, 1e-9, '同刻相接允许：3 可行');
  assert.equal(sched[2].status, 'scheduled');
  approx(sched[2].start, 8, 1e-9, '第一段时窗不够：顺延到第二段时窗');
  approx(sched[2].end, 9);
});

test('执行表：无有效时窗（区间不足 d）记 infeasible 并污染参与者', () => {
  const sched = scheduleOf({
    duration: T,
    performers: crossPerformers(),
    handoffs: [hOver({ id: 'h1', minDuration: 5 })] // 区间 [4,8] 长 4 < 5
  });
  assert.equal(sched[0].status, 'infeasible');
  assert.equal(sched[0].start, null);
  assert.equal(sched[0].end, null);
  assert.equal(sched[0].earliestStart, null);
});

test('执行表：valid=false（同人/表演者缺失）按无可行时窗处理', () => {
  const s1 = scheduleOf({
    duration: T, performers: crossPerformers(), handoffs: [hOver({ bId: 'a' })]
  });
  assert.equal(s1[0].status, 'infeasible');

  const s2 = scheduleOf({
    duration: T, performers: crossPerformers(), handoffs: [hOver({ bId: 'ghost' })]
  });
  assert.equal(s2[0].status, 'infeasible');
});

test('执行表：有时窗但双方最早空闲晚于全部时窗最晚起点记 conflict', () => {
  // 区间 [4,8]、d=3.9 -> 时窗 [4,4.1]；h1 排 4–7.9；h2 earliest=7.9 > 4.1 -> conflict
  const sched = scheduleOf({
    duration: T,
    performers: crossPerformers(),
    handoffs: [
      hOver({ id: 'h1', minDuration: 3.9 }),
      hOver({ id: 'h2', minDuration: 3.9 })
    ]
  });
  assert.equal(sched[0].status, 'scheduled');
  approx(sched[0].end, 7.9);
  assert.equal(sched[1].status, 'conflict');
  approx(sched[1].earliestStart, 7.9);
  assert.equal(sched[1].start, null);
  assert.equal(sched[1].end, null);
});

test('执行表：前序未完成链——infeasible/conflict 后涉及参与者的项 blocked 并继续传递', () => {
  const performers = crossPerformers().concat([
    { id: 'c', name: '丙', radius: 0, keys: [{ t: 0, x: 300, y: 50 }] },
    { id: 'd', name: '丁', radius: 0, keys: [{ t: 0, x: 310, y: 50 }] }
  ]);
  const sched = scheduleOf({
    duration: T,
    performers: performers,
    handoffs: [
      hOver({ id: 'h1', minDuration: 5 }),   // infeasible，污染 甲、乙
      hOver({ id: 'h2', aId: 'a', bId: 'c' }), // blocked（甲被污染），再传 丙
      { id: 'h3', aId: 'c', bId: 'd', x: 290, y: 40, width: 40, height: 20,
        reach: 40, minDuration: 1 },           // blocked（丙被污染），再传 丁
      { id: 'h4', aId: 'c', bId: 'd', x: 290, y: 40, width: 40, height: 20,
        reach: 40, minDuration: 1 }            // blocked（持续传递）
    ]
  });
  assert.deepEqual(sched.map((s) => s.status),
    ['infeasible', 'blocked', 'blocked', 'blocked']);
  sched.forEach((s) => {
    if (s.status === 'blocked') {
      assert.equal(s.start, null);
      assert.equal(s.end, null);
      assert.equal(s.earliestStart, null, 'blocked 项不检查时窗、不登记空闲时刻');
    }
  });
});

test('执行表：conflict 同样使参与者的后续项 blocked；不共用者继续正常排', () => {
  const performers = crossPerformers().concat([
    { id: 'c', name: '丙', radius: 0, keys: [{ t: 0, x: 300, y: 50 }] },
    { id: 'd', name: '丁', radius: 0, keys: [{ t: 0, x: 310, y: 50 }] }
  ]);
  const sched = scheduleOf({
    duration: T,
    performers: performers,
    handoffs: [
      hOver({ id: 'h1', minDuration: 3.9 }),  // 4–7.9
      hOver({ id: 'h2', minDuration: 3.9 }),  // conflict，污染 甲、乙
      hOver({ id: 'h3', aId: 'a', bId: 'c' }), // blocked（甲）
      { id: 'h4', aId: 'c', bId: 'd', x: 290, y: 40, width: 40, height: 20,
        reach: 40, minDuration: 1 }             // 丙被 h3 传递污染 -> blocked
    ]
  });
  assert.deepEqual(sched.map((s) => s.status),
    ['scheduled', 'conflict', 'blocked', 'blocked']);

  // 反向验证：把 h4 换成只含全新表演者戊、己（不与任何未完成项共用），应正常排
  performers.push(
    { id: 'e', name: '戊', radius: 0, keys: [{ t: 0, x: 400, y: 50 }] },
    { id: 'f', name: '己', radius: 0, keys: [{ t: 0, x: 410, y: 50 }] }
  );
  const sched2 = scheduleOf({
    duration: T,
    performers: performers,
    handoffs: [
      hOver({ id: 'h1', minDuration: 3.9 }),
      hOver({ id: 'h2', minDuration: 3.9 }),
      { id: 'h5', aId: 'e', bId: 'f', x: 390, y: 40, width: 40, height: 20,
        reach: 40, minDuration: 1 }
    ]
  });
  assert.deepEqual(sched2.map((s) => s.status),
    ['scheduled', 'conflict', 'scheduled']);
  approx(sched2[2].start, 0, 1e-9, '不共用未完成参与者的项不受阻塞、正常排程');
});

test('执行表：顺序变化即重排——同一组交接调换顺序得到不同结果', () => {
  const performers = crossPerformers();
  const h = [
    hOver({ id: 'short', minDuration: 1 }),   // 时窗 [4,7]
    hOver({ id: 'long', minDuration: 3.9 })   // 时窗 [4,4.1]
  ];
  // 先短后长：short 4–5，long earliest=5 > 4.1 -> conflict
  const sA = scheduleOf({ duration: T, performers, handoffs: h });
  assert.deepEqual(sA.map((s) => s.status), ['scheduled', 'conflict']);
  // 先长后短：long 4–7.9，short earliest=7.9 > 7 -> conflict
  const sB = scheduleOf({ duration: T, performers, handoffs: [h[1], h[0]] });
  assert.deepEqual(sB.map((s) => s.status), ['scheduled', 'conflict']);
  approx(sB[0].end, 7.9);
  // 两者都能排下的 d：先长(2) 4–6、再短(1) 6–7
  const sC = scheduleOf({
    duration: T,
    performers,
    handoffs: [
      hOver({ id: 'long', minDuration: 2 }),
      hOver({ id: 'short', minDuration: 1 })
    ]
  });
  assert.deepEqual(sC.map((s) => s.status), ['scheduled', 'scheduled']);
  approx(sC[0].start, 4);
  approx(sC[0].end, 6);
  approx(sC[1].start, 6);
  approx(sC[1].end, 7);
});

test('执行表：已排项之间不重叠（共享表演者），未完成项不登记占用', () => {
  const performers = crossPerformers().concat([
    { id: 'c', name: '丙', radius: 0, keys: [{ t: 0, x: 0, y: 50 }, { t: 12, x: 120, y: 50 }] }
  ]);
  const sched = scheduleOf({
    duration: T,
    performers,
    handoffs: [
      hOver({ id: 'h1' }),                     // 甲乙 4–5.5
      hOver({ id: 'h2', minDuration: 5 }),     // infeasible（不登记占用）
      hOver({ id: 'h3', aId: 'a', bId: 'c' })  // blocked（甲被污染），不检查
    ]
  });
  const s0 = sched[0];
  assert.equal(s0.status, 'scheduled');
  assert.equal(sched[1].status, 'infeasible');
  assert.equal(sched[2].status, 'blocked');
});

test('buildHandoffSchedule：直接以 handoffResults 调用，顺序即执行顺序', () => {
  const r = core.analyzeScene({ duration: T, performers: crossPerformers(), handoffs: [hOver()] });
  const built = core.buildHandoffSchedule(r.handoffResults);
  assert.equal(built.length, 1);
  assert.equal(built[0].status, 'scheduled');
  assert.deepEqual(core.buildHandoffSchedule(null), []);
  assert.deepEqual(core.buildHandoffSchedule(undefined), []);
  assert.equal(core.HANDOFF_SCHED_STATUS.SCHEDULED, 'scheduled');
  assert.equal(core.HANDOFF_SCHED_STATUS.INFEASIBLE, 'infeasible');
  assert.equal(core.HANDOFF_SCHED_STATUS.CONFLICT, 'conflict');
  assert.equal(core.HANDOFF_SCHED_STATUS.BLOCKED, 'blocked');
});

test('analyzeScene：handoffSchedule 与 handoffResults 等长同序；旧场景为空数组', () => {
  const scene = { duration: T, performers: crossPerformers(), handoffs: [hOver({ id: 'h1' }), hOver({ id: 'h2', minDuration: 5 })] };
  const r = core.analyzeScene(scene);
  assert.equal(r.handoffSchedule.length, 2);
  assert.equal(r.handoffSchedule[0].handoffId, 'h1');
  assert.equal(r.handoffSchedule[1].handoffId, 'h2');
  assert.equal(r.handoffSchedule[0].index, 0);
  assert.equal(r.handoffSchedule[1].index, 1);

  const old = core.analyzeScene({ duration: T, performers: crossPerformers() });
  assert.deepEqual(old.handoffSchedule, []);
});

test('内置样例：单项交接执行表为已排，起点=时窗起点 ≈5.18', () => {
  const r = core.analyzeScene(core.builtinScene());
  assert.equal(r.handoffSchedule.length, 1);
  const s = r.handoffSchedule[0];
  assert.equal(s.status, 'scheduled');
  approx(s.start, 4560 / 880, 1e-9);
  approx(s.end, 4560 / 880 + 0.5, 1e-9);
});
