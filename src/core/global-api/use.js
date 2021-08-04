/* @flow */

import { toArray } from "../util/index";

export function initUse(Vue: GlobalAPI) {
  /**
   * 注册插件 Vue.use(plugin)
   * 本质就是执行插件暴露出来的install方法
   * 开始的时候会有一个判重，放置重复注册同一个插件
   **/
  Vue.use = function (plugin: Function | Object) {
    const installedPlugins =
      this._installedPlugins || (this._installedPlugins = []);
    /**不会重复注册同一个插件 */
    if (installedPlugins.indexOf(plugin) > -1) {
      return this;
    }

    // additional parameters
    /**
     * install(Vue)
     */
    const args = toArray(arguments, 1);
    args.unshift(this);
    if (typeof plugin.install === "function") {
      /**plugin是对象 */
      plugin.install.apply(plugin, args);
    } else if (typeof plugin === "function") {
      /**plugin是函数 */
      plugin.apply(null, args);
    }
    /**将plugin放入已安装的插件数组中 */
    installedPlugins.push(plugin);
    return this;
  };
}
