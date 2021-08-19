/* @flow */

import { addProp } from "compiler/helpers";

/*
 * 为虚拟dom添加textContent 属性
 **/
export default function text(el: ASTElement, dir: ASTDirective) {
  if (dir.value) {
    addProp(el, "textContent", `_s(${dir.value})`, dir);
  }
}
