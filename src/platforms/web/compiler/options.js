/* @flow */

import {
  isPreTag,
  mustUseProp,
  isReservedTag,
  getTagNamespace,
} from "../util/index";

import modules from "./modules/index";
import directives from "./directives/index";
import { genStaticKeys } from "shared/util";
import { isUnaryTag, canBeLeftOpenTag } from "./util";

/**平台级别的配置选项 */
export const baseOptions: CompilerOptions = {
  expectHTML: true,
  /**负责编译class、style、v-model(input) */
  modules,
  /**处理指令 */
  directives,
  /**pre标签 */
  isPreTag,
  /**是否为一元标签(自闭合标签) */
  isUnaryTag,
  /**一些必须用于props进行绑定的属性 */
  mustUseProp,
  /**只有开始标签的标签， 可以只写开始标签的标签，结束标签浏览器会自动补全 */
  canBeLeftOpenTag,
  /**保留标签（html + svg）*/
  isReservedTag,
  /**获取标签的命名空间 */
  getTagNamespace,
  /**静态key */
  staticKeys: genStaticKeys(modules),
};
