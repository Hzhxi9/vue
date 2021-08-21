/* @flow */

import { toNumber, toString, looseEqual, looseIndexOf } from "shared/util";
import { createTextVNode, createEmptyVNode } from "core/vdom/vnode";
import { renderList } from "./render-list";
import { renderSlot } from "./render-slot";
import { resolveFilter } from "./resolve-filter";
import { checkKeyCodes } from "./check-keycodes";
import { bindObjectProps } from "./bind-object-props";
import { renderStatic, markOnce } from "./render-static";
import { bindObjectListeners } from "./bind-object-listeners";
import { resolveScopedSlots } from "./resolve-scoped-slots";
import { bindDynamicKeys, prependModifier } from "./bind-dynamic-keys";

/**
 * 在实例上挂载简写的渲染工具函数，这些都是运行时代码
 * 这些工具函数在编译器生成的渲染函数中被使用到了
 * @param {*} target Vue 实例
 */
export function installRenderHelpers(target: any) {
  /**_c = $createElement */

  /**
   * v-once 指令的运行时帮助程序，为VNode加上静态标记
   * 有点多余，因为含有 v-once 指令的节点都被当作静态节点处理了，所以也不会走这儿
   */
  target._o = markOnce;
  /**
   * 将值转换为数字， 内部是parseFloat方式实现的，如果失败则返回字符串
   */
  target._n = toNumber;
  /**
   * 将值转换为字符串形式，普通值 => String(val)，对象 => JSON.stringify(val)
   */
  target._s = toString;
  /**
   * v-for
   * 运行时渲染 v-for 列表的帮助函数，循环遍历 val 值，依次为每一项执行 render 方法生成 VNode，最终返回一个 VNode 数组
   **/
  target._l = renderList;
  /**
   * 用于呈现插槽<slot>的运行时帮助函数，创建虚拟slot VNode
   */
  target._t = renderSlot;
  /**
   * 判断两个值是否相等,类似于 ==，
   * 检测a 和 b的数据类型，是否是不是数组或者对象，对象的key长度一样即可，数组长度一样即可
   * 或者arr数组中的对象，或者对象数组是否和val相等
   */
  target._q = looseEqual;
  /**
   * 相当于 indexOf 方法
   */
  target._i = looseIndexOf;
  /**
   * 渲染静态节点
   * 运行时负责生成静态树的 VNode 的帮助程序，完成了以下两件事
   *   1、执行 staticRenderFns 数组中指定下标的渲染函数，生成静态树的 VNode 并缓存，下次在渲染时从缓存中直接读取（isInFor 必须为 true）
   *   2、为静态树的 VNode 打静态标记
   */
  target._m = renderStatic;
  /**
   * 解析filter过滤器
   */
  target._f = resolveFilter;
  /**
   * 检查两个key是否相等， 如果不相等返回true，相等返回false
   */
  target._k = checkKeyCodes;
  /**
   * 用于将v-bind="object"合并到VNode的数据中的运行时帮助函数
   * 检查value是否是对象，并且为value添加update事件
   */
  target._b = bindObjectProps;
  /**
   * 为文本节点创建 VNode
   */
  target._v = createTextVNode;
  /**
   * 为空节点创建 VNode
   */
  target._e = createEmptyVNode;
  /**
   * 作用域插槽
   */
  target._u = resolveScopedSlots;
  /**
   * 判断value是否是对象，并且为数据data.on合并到value.on事件
   */
  target._g = bindObjectListeners;
  target._d = bindDynamicKeys;
  target._p = prependModifier;
}
