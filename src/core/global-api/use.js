/* @flow */

import { toArray } from "../util/index";

export function initUse(Vue: GlobalAPI) {
  /**
   * 注册插件 Vue.use(plugin)
   * 本质就是执行插件暴露出来的install方法
   * 开始的时候会有一个判重，放置重复注册同一个插件
   * 
   * 1. 判断插件是否已经被安装， 如果安装则直接结束
   * 2. 安装插件，执行插件的install方法
   * 
   * @param {*} plugin install 方法或者包含 install方法的对象
   * @returns Vue实例
   **/
  Vue.use = function (plugin: Function | Object) {
    /**获取安装过的插件列表 */
    const installedPlugins =
      this._installedPlugins || (this._installedPlugins = []);
    /**
     * 判断 plugin 是否已经安装，保证不会重复安装
     * 不会重复注册同一个插件 
     **/
    if (installedPlugins.indexOf(plugin) > -1) {
      return this;
    }

    // additional parameters
    /**
     * 将 Vue 构造函数放到第一个参数位置，然后将这些参数传递给install方法
     * install(Vue)
     */
    const args = toArray(arguments, 1);
    args.unshift(this);

    if (typeof plugin.install === "function") {
      /**plugin是对象，则执行其 install 方法安装插件 */
      plugin.install.apply(plugin, args);
    } else if (typeof plugin === "function") {
      /**plugin是函数，直接执行 plugin 方案安装插件 */
      plugin.apply(null, args);
    }
    /**将plugin放入已安装的插件数组中 */
    installedPlugins.push(plugin);
    return this;
  };
}
