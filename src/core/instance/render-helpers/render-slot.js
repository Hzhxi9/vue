/* @flow */

import { extend, warn, isObject } from "core/util/index";

/**
 * Runtime helper for rendering <slot>
 * 用于呈现<slot>的运行时帮助程序
 * @param {*} name 子组件中slot的name，匿名default
 * @param {*} fallbackRender 子组件插槽中默认内容VNode， 如果没有插槽内容，则显示该内容
 * @param {*} props 子组件传递到插槽的props
 * @param {*} bindObject 针对 <slot v-bind="obj" /> obj必须是一个对象
 * @returns
 */
export function renderSlot(
  name: string,
  fallbackRender: ?((() => Array<VNode>) | Array<VNode>),
  props: ?Object,
  bindObject: ?Object
): ?Array<VNode> {
  /**判断父组件是否传递作用域插槽 */
  const scopedSlotFn = this.$scopedSlots[name];

  /**虚拟DOM */
  let nodes;

  if (scopedSlotFn) {
    /**处理作用域插槽 */

    props = props || {};
    if (bindObject) {
      /**bindObject 必须是一个对象 */
      if (process.env.NODE_ENV !== "production" && !isObject(bindObject)) {
        warn("slot v-bind without argument expects an Object", this);
      }

      /**合并对象和props属性 */
      props = extend(extend({}, bindObject), props);
    }

    /**传入props生成相应的VNode */
    nodes =
      scopedSlotFn(props) ||
      (typeof fallbackRender === "function"
        ? fallbackRender()
        : fallbackRender);
  } else {
    /**处理不是作用域插槽 */

    nodes =
      this.$slots[name] ||
      (typeof fallbackRender === "function"
        ? fallbackRender()
        : fallbackRender);
  }

  /**props属性存在并且属性的插槽存在props.slot */
  const target = props && props.slot;


  /**
   * 如果还需要向子组件的子组件传递slot
   * Bar组件： <p class="bar"><slot name="foo"></slot></p>
   * Foo组件： <p class="foo"><bar><slot slot="foo"/></bar></p>
   * Main组件： <p><foo>hello</foo></p>
   * 
   * 最终渲染： <p class="foo"><p class="bar">hello</p></p>
   */
  
  if (target) {
    /**
     * 创建模板，创建DOM节点，虚拟DOM需要渲染的数据结构
     */
    return this.$createElement("template", { slot: target }, nodes);
  } else {
    return nodes;
  }
}
