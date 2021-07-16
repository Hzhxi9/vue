/* @flow */

import { hasOwn } from "shared/util";
import { warn, hasSymbol } from "../util/index";
import { defineReactive, toggleObserving } from "../observer/index";

/**
 * 解析组件配置项上的provide对象，将其挂载到vm._provided属性上
 * @param {*} vm
 */
export function initProvide(vm: Component) {
  const provide = vm.$options.provide;
  if (provide) {
    vm._provided = typeof provide === "function" ? provide.call(vm) : provide;
  }
}

/**
 * 解析inject选项
 * 1. 得到{ key: val }形式的配置对象
 * 2. 对解析结果做响应式处理
 * @param {*} vm
 */
export function initInjections(vm: Component) {
  /**
   * 从配置项中解析 inject 选项，
   * 然后从祖代组件的配置找到配置项中每一个key对应的val
   * 最后得到result[key] = val的结果
   **/
  const result = resolveInject(vm.$options.inject, vm);

  /**
   * 对result做数据响应式处理，也有代理inject配置中每个key到vm实例的作用
   * 不建议在子组件去更改这些数据，因为一旦祖代组件中注入的provide发生更改，你在组件中做的更改就会被覆盖
   */
  if (result) {
    toggleObserving(false);
    Object.keys(result).forEach((key) => {
      /* istanbul ignore else */
      if (process.env.NODE_ENV !== "production") {
        defineReactive(vm, key, result[key], () => {
          warn(
            `Avoid mutating an injected value directly since the changes will be ` +
              `overwritten whenever the provided component re-renders. ` +
              `injection being mutated: "${key}"`,
            vm
          );
        });
      } else {
        /**
         * 解析结果做响应式处理
         * 将每个key代理到vue实例上
         */
        defineReactive(vm, key, result[key]);
      }
    });
    toggleObserving(true);
  }
}

/**
 * 解析 inject 配置项，从祖代组件的 provide 配置中找到 key 对应的值，否则用 默认值，最后得到 result[key] = val
 * inject 对象肯定是以下这个结构，因为在 合并 选项时对组件配置对象做了标准化处理
 * @param {*} inject  = {
 *  key: {
 *    from: provideKey,
 *    default: xx
 *  }
 * }
 * @param {*} vm
 * @returns {key: val}
 */
export function resolveInject(inject: any, vm: Component): ?Object {
  if (inject) {
    // inject is :any because flow is not smart enough to figure out cached
    const result = Object.create(null);

    /**inject 配置项的所有的key */
    const keys = hasSymbol ? Reflect.ownKeys(inject) : Object.keys(inject);
    /**
     * 遍历inject选项中key组成的数组
     */
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      // #6574 in case the inject object is observed...

      /**跳过__ob__对象 */
      if (key === "__ob__") continue;

      /** 获取provide中对应的key */
      const provideKey = inject[key].from;
      /** 从祖代组件的配置项中找到provide选项，从而找到对应key的值 ，最后得到 result[key] = provide[provideKey]*/
      let source = vm;
      while (source) {
        if (source._provided && hasOwn(source._provided, provideKey)) {
          result[key] = source._provided[provideKey];
          break;
        }
        source = source.$parent;
      }
      /**
       * 如果上一个循环没有找到，则采用inject[key].default
       * 如果没有设置default值，则抛出错误
       **/
      if (!source) {
        /** 设置默认值 */
        if ("default" in inject[key]) {
          const provideDefault = inject[key].default;
          result[key] =
            typeof provideDefault === "function"
              ? provideDefault.call(vm)
              : provideDefault;
        } else if (process.env.NODE_ENV !== "production") {
          warn(`Injection "${key}" not found`, vm);
        }
      }
    }
    return result;
  }
}
