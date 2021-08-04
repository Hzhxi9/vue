/* @flow */

import { ASSET_TYPES } from "shared/constants";
import { isPlainObject, validateComponentName } from "../util/index";

export function initAssetRegisters(Vue: GlobalAPI) {
  /**
   * Create asset registration methods.
   * 初始化Vue.component、 Vue.directive、 Vue.filter
   */
  ASSET_TYPES.forEach((type) => {
    /**
     * 以component 为例 type = component
     * 定义Vue.component = function(){}
     * Vue.component(CompName, Comp)
     * @param {*} id
     * @param {*} definition
     * @returns
     */
    Vue[type] = function (
      id: string,
      definition: Function | Object
    ): Function | Object | void {
      if (!definition) {
        return this.options[type + "s"][id];
      } else {
        /* istanbul ignore if */
        if (process.env.NODE_ENV !== "production" && type === "component") {
          /**验证组件name */
          validateComponentName(id);
        }
        if (type === "component" && isPlainObject(definition)) {
          /**设置组件name */
          definition.name = definition.name || id;

          /**调用Vue.extend方法，基于definition去扩展一个新的组件子类，直接new definition()实例化一个组件 */
          definition = this.options._base.extend(definition);
        }
        if (type === "directive" && typeof definition === "function") {
          definition = { bind: definition, update: definition };
        }

        /**
         * 挂载到this.options 全局配置项
         * this.options[components] = { CompName: definition }
         **/
        this.options[type + "s"][id] = definition;
        return definition;
      }
    };
  });
}
