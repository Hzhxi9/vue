/* @flow */

import type VNode from 'core/vdom/vnode'

/**
 * Runtime helper for resolving raw children VNodes into a slot object.
 * 
 * 判断children 有没有分发式插槽 并且过滤掉空的插槽,并且收集插槽
 */
export function resolveSlots (
  children: ?Array<VNode>,
  context: ?Component
): { [key: string]: Array<VNode> } {
  /**如果没有子节点， 则返回一个空对象 */
  if (!children || !children.length) {
    return {}
  }
  const slots = {}

  /**循环子节点 */
  for (let i = 0, l = children.length; i < l; i++) {
    /**获取单个节点 */
    const child = children[i]

    /**获取子节点数据 */
    const data = child.data

    // remove slot attribute if the node is resolved as a Vue slot node
    /**
     * 如果节点被解析为Vue槽节点， 则删除slot属性，slot分发属性
     */
    if (data && data.attrs && data.attrs.slot) {
      delete data.attrs.slot
    }
    // named slots should only be respected if the vnode was rendered in the
    // same context.
    if ((child.context === context || child.fnContext === context) &&
      data && data.slot != null
    ) {
      const name = data.slot
      const slot = (slots[name] || (slots[name] = []))
      if (child.tag === 'template') {
        slot.push.apply(slot, child.children || [])
      } else {
        slot.push(child)
      }
    } else {
      (slots.default || (slots.default = [])).push(child)
    }
  }
  // ignore slots that contains only whitespace
  for (const name in slots) {
    if (slots[name].every(isWhitespace)) {
      delete slots[name]
    }
  }
  return slots
}

function isWhitespace (node: VNode): boolean {
  return (node.isComment && !node.asyncFactory) || node.text === ' '
}
