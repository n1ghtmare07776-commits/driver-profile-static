import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
const start = source.indexOf("function startLoadTask");
const end = source.indexOf("function getDateFilter", start);
assert.ok(start >= 0 && end > start, "找不到进度条控制函数");

const classes = new Set(["hidden"]);
const timers = new Map();
const frames = new Map();
let sequence = 0;
const loadProgress = {
  classList: {
    add: (name) => classes.add(name),
    remove: (name) => classes.delete(name),
    contains: (name) => classes.has(name),
  },
};
const loadProgressBar = { style: { width: "0%", transition: "" }, offsetWidth: 100 };
const loadProgressText = { textContent: "" };
const windowStub = {
  setTimeout: (callback) => { const id = ++sequence; timers.set(id, callback); return id; },
  clearTimeout: (id) => timers.delete(id),
  requestAnimationFrame: (callback) => { const id = ++sequence; frames.set(id, callback); return id; },
  cancelAnimationFrame: (id) => frames.delete(id),
};
const context = {
  loadTaskId: 0,
  loadProgressPercent: 0,
  loadProgressHideTimer: null,
  loadProgressShowFrame: null,
  loadProgress,
  loadProgressBar,
  loadProgressText,
  dailyDataLoadedMessage: () => "数据读取完毕",
  window: windowStub,
};
vm.createContext(context);
vm.runInContext(source.slice(start, end), context);

const runFrames = () => {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback());
};

const firstTask = context.startLoadTask(5, "查询一");
runFrames();
context.updateLoadProgress(70, "查询一", firstTask);
context.updateLoadProgress(30, "迟到的旧进度", firstTask);
assert.equal(loadProgressBar.style.width, "70%", "同一任务的进度发生倒退");

context.hideLoadProgress(firstTask);
assert.equal(loadProgressBar.style.width, "100%", "完成状态未到100% ");
const secondTask = context.startLoadTask(4, "查询二");
assert.equal(loadProgress.classList.contains("hidden"), true, "100%重置时仍对用户可见");
assert.equal(loadProgressBar.style.width, "4%", "新任务没有在隐藏状态重置");
context.updateLoadProgress(95, "旧任务回调", firstTask);
assert.equal(loadProgressBar.style.width, "4%", "旧任务改写了新任务进度");
context.updateLoadProgress(2, "新任务迟到的低进度", secondTask);
assert.equal(loadProgressBar.style.width, "4%", "新任务自身进度发生倒退");
runFrames();
assert.equal(loadProgress.classList.contains("hidden"), false, "新任务没有重新显示");
assert.ok(secondTask > firstTask);

console.log("进度条单调性验证通过：旧任务隔离，100%重置不可见");
