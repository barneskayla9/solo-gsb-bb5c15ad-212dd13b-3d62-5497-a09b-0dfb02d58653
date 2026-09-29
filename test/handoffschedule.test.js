'use strict';

/**
 * 交接执行表（handoffSchedule / scheduleHandoffs）引擎用例：
 *  - 按列表顺序逐项排定：沿用各项起始时窗与最短持续秒数，选取不早于
 *    双方各自上一项已排交接结束时刻的最早可行起点；
 *  - 共用表演者的交接不重叠（结束与下一项开始同刻允许），不共用者可并行；
 *  - 多时窗时跳过已被占用的过早时窗，取首个可行时窗；
 *  - 三态未完成：无可行时窗（no-window）/ 排程冲突（conflict）/
 *    前序未完成（blocked），未完成项向其参与者后续项传递，无关项继续排；
 *  - 顺序变化即时改变排程结果；
 *  - analyzeScene 的 handoffSchedule 装配及旧场景（无 handoffs）兼容。
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../public/core.js');

function approx(actual, expected, tol = 1e-9, label) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label || '值'} 期望 ${expected}，实际 ${actual}`
  );
}

// 直接合成 handoffResults（绕开几何）便于纯排程逻辑用例
function res(id, aId, bId, windows, d, over) {
  return Object.assign({
    handoffId: id,
    aId: aId,
    bId: bId,
    valid: true,
    feasible: windows.length > 0,
    intervals: [],
    windows: windows,
    handoff: { id: id, aId: aId, bId: bId, minDuration: d }
  }, over || {});
}

test('执行表：单项排定在首个时窗起点，占用 [s, s+d]', () => {
  const sch = core.scheduleHandoffs([res('h1', 'a', 'b', [[4, 6.5]], 1.5)]);
  assert.equal(sch.length, 1);
  assert.equal(sch[0].handoffId, 'h1');
  assert.equal(sch[0].status, 'scheduled');
  approx(sch[0].start, 4);
  approx(sch[0].end, 5.5);
  assert.deepEqual(sch[0].window, [4, 6.5]);
});

test('执行表：共用表演者不重叠——第二项不早于第一项结束，同刻相接允许', () => {
  const sch = core.scheduleHandoffs([
    res('h1', 'a', 'b', [[0, 10]], 2),
    res('h2', 'a', 'c', [[0, 10]], 2),
    res('h3', 'b', 'c', [[0, 10]], 2)
  ]);
  // h1 [0,2]；h2 与 h1 共用 a → 起点 2（同刻相接允许）；h3 与 h1 共用 b、
  // 与 h2 共用 c → 不早于 max(2, 4)=4
  approx(sch[0].start, 0);
  approx(sch[0].end, 2);
  approx(sch[1].start, 2, 1e-9, 'h2 起点即 h1 结束时刻');
  approx(sch[1].end, 4);
  approx(sch[2].start, 4);
  approx(sch[2].end, 6);
  assert.ok(sch.every((e) => e.status === 'scheduled'));
});

test('执行表：不共用表演者的交接可并行（各自从时窗起点开始）', () => {
  const sch = core.scheduleHandoffs([
    res('h1', 'a', 'b', [[1, 5]], 2),
    res('h2', 'c', 'd', [[2, 6]], 2)
  ]);
  approx(sch[0].start, 1);
  approx(sch[1].start, 2, 1e-9, '无关项不受前项占用影响');
});

test('执行表：过早时窗被前项占用时跳过，取首个可行时窗', () => {
  const sch = core.scheduleHandoffs([
    res('h1', 'a', 'b', [[2, 3], [8, 9]], 2), // 占用 [2,4]
    res('h2', 'a', 'b', [[2, 3], [8, 9]], 1)
  ]);
  approx(sch[0].start, 2);
  approx(sch[0].end, 4);
  // h2 最早可用 4：时窗 [2,3] 终点 3 < 4 不可行 → 取 [8,9]，起点 8
  approx(sch[1].start, 8);
  approx(sch[1].end, 9);
  assert.deepEqual(sch[1].window, [8, 9]);
});

test('执行表：时窗内被部分占用时起点顺延到时窗内最早可行处', () => {
  const sch = core.scheduleHandoffs([
    res('h1', 'a', 'b', [[0, 10]], 3), // 占用 [0,3]
    res('h2', 'b', 'c', [[2, 8]], 1)   // 最早可用 3，落在时窗 [2,8] 内
  ]);
  approx(sch[1].start, 3);
  approx(sch[1].end, 4);
});

test('执行表：单点时窗（区间长恰为 d）可排定；最早可用恰等于时窗终点也可排', () => {
  const sch = core.scheduleHandoffs([
    res('h1', 'a', 'b', [[0, 2]], 2),  // 占用 [0,2]
    res('h2', 'a', 'c', [[2, 2]], 1)   // 单点时窗 2，最早可用 2 → 同刻相接
  ]);
  assert.equal(sch[1].status, 'scheduled');
  approx(sch[1].start, 2);
  approx(sch[1].end, 3);
});

test('执行表：无可行时窗记 no-window，并使其参与者的后续项 blocked', () => {
  const sch = core.scheduleHandoffs([
    res('h1', 'a', 'b', [], 1),          // 无有效时窗
    res('h2', 'b', 'c', [[0, 10]], 1),   // 涉及 b → 前序未完成
    res('h3', 'c', 'd', [[0, 10]], 1),   // h2 未完成传递至 c → 前序未完成
    res('h4', 'e', 'f', [[1, 5]], 1)     // 无关项继续排
  ]);
  assert.equal(sch[0].status, 'no-window');
  assert.equal(sch[0].start, null);
  assert.equal(sch[0].end, null);
  assert.equal(sch[1].status, 'blocked');
  assert.equal(sch[2].status, 'blocked', 'blocked 继续向其参与者传递');
  assert.equal(sch[3].status, 'scheduled');
  approx(sch[3].start, 1);
});

test('执行表：有时窗但受前项占用而无法安排记 conflict，并同样传递', () => {
  const sch = core.scheduleHandoffs([
    res('h1', 'a', 'b', [[0, 4]], 8),    // 占用 [0,8]
    res('h2', 'a', 'c', [[4, 7]], 1),    // 时窗终点 7 < 最早可用 8 → 排程冲突
    res('h3', 'c', 'd', [[0, 12]], 1),   // 涉及 c → 前序未完成（并传递至 d）
    res('h4', 'e', 'f', [[0, 12]], 1)    // 不涉及未完成参与者 → 继续排
  ]);
  assert.equal(sch[0].status, 'scheduled');
  assert.equal(sch[1].status, 'conflict');
  assert.equal(sch[1].start, null);
  assert.equal(sch[2].status, 'blocked');
  assert.equal(sch[3].status, 'scheduled');
  approx(sch[3].start, 0);
});

test('执行表：配置无效（valid=false）按无可行时窗处理并传递', () => {
  const sch = core.scheduleHandoffs([
    res('h1', 'a', 'a', [], 1, { valid: false, feasible: false }), // aId===bId
    res('h2', 'a', 'b', [[0, 10]], 1)
  ]);
  assert.equal(sch[0].status, 'no-window');
  assert.equal(sch[1].status, 'blocked');
});

test('执行表：顺序变化即时改变排程结果', () => {
  const h1 = res('h1', 'a', 'b', [[0, 9]], 3); // 时窗宽
  const h2 = res('h2', 'a', 'c', [[4, 7]], 1); // 时窗 [4,7]
  const fwd = core.scheduleHandoffs([h1, h2]);
  approx(fwd[0].start, 0);
  approx(fwd[1].start, 4, 1e-9, 'h1 先排占用 [0,3]，h2 仍从时窗起点 4 开始');
  const rev = core.scheduleHandoffs([h2, h1]);
  approx(rev[0].start, 4);
  approx(rev[1].start, 5, 1e-9, 'h2 先排占用 [4,5]，h1 顺延到 5');
  approx(rev[1].end, 8);
});

test('执行表：空列表与非法入参返回空数组', () => {
  assert.deepEqual(core.scheduleHandoffs([]), []);
  assert.deepEqual(core.scheduleHandoffs(null), []);
  assert.deepEqual(core.scheduleHandoffs(undefined), []);
});

// ---------- 几何联动（analyzeScene 装配） ----------

// 甲、乙静止在交接区内；丙匀速横穿
function staticScene(handoffs) {
  return {
    duration: 12,
    performers: [
      { id: 'a', name: '甲', radius: 0, keys: [{ t: 0, x: 50, y: 50 }] },
      { id: 'b', name: '乙', radius: 0, keys: [{ t: 0, x: 55, y: 50 }] },
      { id: 'c', name: '丙', radius: 0, keys: [{ t: 0, x: 0, y: 50 }, { t: 12, x: 120, y: 50 }] }
    ],
    handoffs: handoffs
  };
}

test('analyzeScene：handoffSchedule 与交接列表同序装配，共用者顺延、同刻相接', () => {
  const scene = staticScene([
    { id: 'h1', aId: 'a', bId: 'b', x: 40, y: 40, width: 40, height: 20, reach: 10, minDuration: 2 },
    { id: 'h2', aId: 'a', bId: 'c', x: 40, y: 40, width: 40, height: 20, reach: 200, minDuration: 1 }
  ]);
  const r = core.analyzeScene(scene);
  assert.equal(r.handoffSchedule.length, 2);
  // h1：甲、乙全程在区内 → 区间 [0,12]，时窗 [0,10]，排定 [0,2]
  assert.equal(r.handoffSchedule[0].handoffId, 'h1');
  assert.equal(r.handoffSchedule[0].status, 'scheduled');
  approx(r.handoffSchedule[0].start, 0);
  approx(r.handoffSchedule[0].end, 2);
  // h2：丙 t∈(4,8) 在区内 → 时窗 [4,7]；甲上一项 2 结束 < 4 → 排定 [4,5]
  assert.equal(r.handoffSchedule[1].handoffId, 'h2');
  assert.equal(r.handoffSchedule[1].status, 'scheduled');
  approx(r.handoffSchedule[1].start, 4);
  approx(r.handoffSchedule[1].end, 5);
});

test('analyzeScene：前项占用导致排程冲突（时窗全部早于可用人手）', () => {
  const scene = staticScene([
    { id: 'h1', aId: 'a', bId: 'b', x: 40, y: 40, width: 40, height: 20, reach: 10, minDuration: 8 },
    { id: 'h2', aId: 'a', bId: 'c', x: 40, y: 40, width: 40, height: 20, reach: 200, minDuration: 1 }
  ]);
  const r = core.analyzeScene(scene);
  // h1 排定 [0,8]；h2 时窗 [4,7] 全部早于甲的可用时刻 8 → 排程冲突
  assert.equal(r.handoffSchedule[0].status, 'scheduled');
  approx(r.handoffSchedule[0].end, 8);
  assert.equal(r.handoffSchedule[1].status, 'conflict');
  assert.equal(r.handoffSchedule[1].start, null);
});

test('analyzeScene：区间不足 d 的项记无可行时窗，涉及其参与者的后续项前序未完成', () => {
  const scene = staticScene([
    // 丙在区内仅 (4,8)，长 4 < d=5 → 无有效时窗
    { id: 'h1', aId: 'a', bId: 'c', x: 40, y: 40, width: 40, height: 20, reach: 200, minDuration: 5 },
    { id: 'h2', aId: 'a', bId: 'b', x: 40, y: 40, width: 40, height: 20, reach: 10, minDuration: 1 }
  ]);
  const r = core.analyzeScene(scene);
  assert.equal(r.handoffResults[0].feasible, false);
  assert.equal(r.handoffSchedule[0].status, 'no-window');
  assert.equal(r.handoffSchedule[1].status, 'blocked', 'h2 涉及 h1 的参与者甲');
});

test('analyzeScene：旧场景（无 handoffs）执行表为空数组', () => {
  const r = core.analyzeScene({
    duration: 10,
    performers: [
      { id: 'a', radius: 1, keys: [{ t: 0, x: 0, y: 0 }] },
      { id: 'b', radius: 1, keys: [{ t: 0, x: 100, y: 0 }] }
    ]
  });
  assert.deepEqual(r.handoffSchedule, []);
});

test('内置样例：单项交接排定在时窗起点 ≈5.18，结束 ≈5.68', () => {
  const r = core.analyzeScene(core.builtinScene());
  assert.equal(r.handoffSchedule.length, 1);
  const e = r.handoffSchedule[0];
  assert.equal(e.handoffId, 'h1');
  assert.equal(e.status, 'scheduled');
  approx(e.start, 4560 / 880);
  approx(e.end, 4560 / 880 + 0.5);
});
