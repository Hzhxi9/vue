/* @flow */

import { addProp } from "compiler/helpers";

/*
 * 为虚拟dom添加innerHTML 属性
 * */
export default function html(el: ASTElement, dir: ASTDirective) {
  if (dir.value) {
    addProp(el, "innerHTML", `_s(${dir.value})`, dir);
  }
}
