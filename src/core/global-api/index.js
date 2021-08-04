/* @flow */

import config from "../config";
import { initUse } from "./use";
import { initMixin } from "./mixin";
import { initExtend } from "./extend";
import { initAssetRegisters } from "./assets";
import { set, del } from "../observer/index";
import { ASSET_TYPES } from "shared/constants";
import builtInComponents from "../components/index";
import { observe } from "core/observer/index";

import {
  warn,
  extend,
  nextTick,
  mergeOptions,
  defineReactive,
} from "../util/index";

/**
 * 初始化Vue的众多全局API，比如
 * 默认配置: Vue.config
 * 工具方法: Vue.util.xx
 * Vue.set、 Vue.delete、 Vue.nextTick、 Vue.observable
 * Vue.options.components、 Vue.options.directives、 Vue.options.filters、 Vue.options._base
 * Vue.use、 Vue.extend、 Vue.mixin、 Vue.component、 Vue.directive、 Vue.filter
 * @param {*} Vue
 */

export function initGlobalAPI(Vue: GlobalAPI) {
  // config
  const configDef = {};

  /**
   * Vue 的全局默认配置项
   * @returns
   */
  configDef.get = () => config;
  if (process.env.NODE_ENV !== "production") {
    configDef.set = () => {
      warn(
        "Do not replace the Vue.config object, set individual fields instead."
      );
    };
  }

  /**
   * 设置Vue.config属性， 将配置代理到Vue对象上，通过Vue.config的方式去访问
   */
  Object.defineProperty(Vue, "config", configDef);

  // exposed util methods.
  // NOTE: these are not considered part of the public API - avoid relying on
  // them unless you are aware of the risk.
  /**
   * 暴露一些内部的工具方法
   * 轻易不要使用这些工具方法，处理你很清楚这些工具方法，以及知道使用的风险
   */
  Vue.util = {
    /**警告日志 */
    warn,
    /**
     * 类似选项合并，将A对象上的属性复制到B对象上
     * shared/utils
     */
    extend,
    /**合并选项 */
    mergeOptions,
    /**设置响应式，给对象设置getter/setter，涉及到依赖收集更新，触发依赖更新 */
    defineReactive,
  };

  /**Vue.set */
  Vue.set = set;
  /**Vue.delete */
  Vue.delete = del;
  /**Vue.nextTick */
  Vue.nextTick = nextTick;

  // 2.6 explicit observable API
  /**向外暴露为对象设置响应式方法 */
  Vue.observable = <T>(obj: T): T => {
    /*为对象设置响应式 */
    observe(obj);
    return obj;
  };

  /**
   * Vue.options.components/directives/filter
   *
   * Vue.options = {
   *    component: {},
   *    directive: {},
   *    filter: {}
   * }
   **/
  Vue.options = Object.create(null);
  ASSET_TYPES.forEach((type) => {
    Vue.options[type + "s"] = Object.create(null);
  });

  // this is used to identify the "base" constructor to extend all plain-object
  // components with in Weex's multi-instance scenarios.
  /**将构造函数挂载到Vue.options._base上 */
  Vue.options._base = Vue;

  /**在Vue.options.components 中添加内置组件， 比如keep-alive */
  extend(Vue.options.components, builtInComponents);

  /**Vue.use */
  initUse(Vue);
  /**Vue.mixin */
  initMixin(Vue);
  /**Vue.extend */
  initExtend(Vue);
  /**Vue.component/directive/filter */
  initAssetRegisters(Vue);
}
