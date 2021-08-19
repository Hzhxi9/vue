/* @flow */

import { addProp } from "compiler/helpers";

/*
 * 为虚拟dom添加textContent 属性
 **/
export default function text(el: ASTElement, dir: ASTDirective) {
  if (dir.value) {
    /**在el对象添加textContent属性, 值为_s(value) */
    addProp(el, "textContent", `_s(${dir.value})`, dir);
  }
}
