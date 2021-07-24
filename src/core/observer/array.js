/*
 * not type checking this file because flow doesn't play well with
 * dynamically accessing methods on Array prototype
 */

import { def } from "../util/index";

/**
 * 基于数组原型对象创建一个新的对象
 * 复写增强array原型方法，使其具有依赖通知更新的能力
 *
 * 这里是面向切片编程思想（AOP）--不破坏封装的前提下，动态的扩展功能
 */
const arrayProto = Array.prototype;
export const arrayMethods = Object.create(arrayProto);

const methodsToPatch = [
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
];

/**
 * Intercept mutating methods and emit events
 */
methodsToPatch.forEach(function (method) {
  // cache original method
  const original = arrayProto[method];

  /**分别在arrayMethods对象上定义那七个方法 */
  def(arrayMethods, method, function mutator(...args) {
    /**
     * 这里保留原型方法的执行结果
     * 先执行原生的数组方法
     **/
    const result = original.apply(this, args);

    /**this代表的就是数据本身 比如数据是{a:[1,2,3]} 那么我们使用a.push(4)  this就是a  ob就是a.__ob__ 这个属性就是上段代码增加的 代表的是该数据已经被响应式观察过了指向Observer实例 */
    const ob = this.__ob__;
    let inserted;
    switch (method) {
      case "push":
      case "unshift":
        inserted = args;
        break;
      case "splice":
        inserted = args.slice(2);
        break;
    }
    /**
     * 如果执行的是push unshift splice操作的话，进行响应式处理
     * 如果有新增的元素 inserted是一个数组 调用Observer实例的observeArray对数组每一项进行观测
     * */
    if (inserted) ob.observeArray(inserted);
    // notify change
    ob.dep.notify();
    return result;
  });
});
