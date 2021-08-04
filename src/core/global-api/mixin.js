/* @flow */

import { mergeOptions } from "../util/index";

/**
 * 定义 Vue.mixin，负责全局混入选项， 影响之后所有创建的Vue实例
 * 这些实例会合并全局混入的选项
 * @param {*} Vue Vue 配置对象
 */
export function initMixin(Vue: GlobalAPI) {
  /**
   * 利用mergeOptions合并两个选项
   * @param {}} mixin
   * @returns
   */
  Vue.mixin = function (mixin: Object) {
    /**
     * 在Vue的默认配置项上合并mixin对象
     */
    this.options = mergeOptions(this.options, mixin);
    return this;
  };
}
