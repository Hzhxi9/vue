/* @flow */

import { ASSET_TYPES } from "shared/constants";
import { isPlainObject, validateComponentName } from "../util/index";

export function initAssetRegisters(Vue: GlobalAPI) {
  /**
   * Create asset registration methods.
   * 初始化Vue.component、 Vue.directive、 Vue.filter
   * 这个三个方法所做的事情类似的，就是在this.options.xx 上存放对应的配置
   * 
   * 比如 Vue.component(compName, {xx}) 结果是 this.options.components.compName = 组件构造函数
   * 
   * ASSET_TYPES = ['component', 'directive', 'filter']
   */
  ASSET_TYPES.forEach((type) => {
    /**
     * 以component 为例 type = component
     * 定义Vue.component = function(){}
     * Vue.component(CompName, definition)
     * @param {*} id name
     * @param {*} definition 组件构造函数或者配置对象
     * @returns 组件构造函数
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
          /**
           * 设置组件name，如果组件配置中存在name,则使用name，否则直接使用id
           **/
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
         * 
         * 在实例化时通过mergeOptions将全局注册的组件合并到每个组件的配置对象的component中
         **/
        this.options[type + "s"][id] = definition;
        return definition;
      }
    };
  });
}
