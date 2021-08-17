/* @flow */

import { makeMap, isBuiltInTag, cached, no } from "shared/util";

let isStaticKey;
let isPlatformReservedTag;

const genStaticKeysCached = cached(genStaticKeys);

/**
 * Goal of the optimizer: walk the generated template AST tree
 * and detect sub-trees that are purely static, i.e. parts of
 * the DOM that never needs to change.
 *
 * Once we detect these sub-trees, we can:
 *
 * 1. Hoist them into constants, so that we no longer need to
 *    create fresh nodes for them on each re-render;
 * 2. Completely skip them in the patching process.
 *
 * 优化器的目标:遍历生成的模板AST树
 *    检测纯静态的子树，即永远不需要更改的DOM。
 * 1. 把它们变成常数，这样我们就不需要在每次重新渲染时为它们创建新的节点;
 * 2. 在修补过程中完全跳过它们。
 *
 * 循环递归虚拟node，标记是不是静态节点
 *
 * 根据node.static或者 node.once 标记staticRoot的状态
 *
 * 优化
 *    遍历AST， 标记每个节点是静态节点还是动态节点，然后标记静态根节点
 *    后续更新过程中就不需要在关注这些节点
 *
 */
export function optimize(root: ?ASTElement, options: CompilerOptions) {
  if (!root) return;
  /**
   * options.staticKey = 'staticClass, staticStyle'
   * isStaticKey = function(val){ return map[val] }
   * 匹配type,tag,attrsList,attrsMap,plain,parent,children,attrs + staticKeys 字符串
   */
  isStaticKey = genStaticKeysCached(options.staticKeys || "");

  /**平台保留标签，判断是不是真的是 html 原有的标签 或者svg标签 */
  isPlatformReservedTag = options.isReservedTag || no;

  /**
   * first pass: mark all non-static nodes.
   * 遍历所有节点， 给每个节点设置static属性， 标记其是否为静态节点
   */
  markStatic(root);

  /**
   * second pass: mark static roots.
   * 进一步标记静态根节点，一个节点要成为静态根节点，需要具体以下条件
   *    1. 节点本身是静态节点，而且有子节点，而且子节点不只是一个文本节点，则标记为静态根
   *    2. 静态根节点不能只有静态文本的子节点，因为这样收益太低，这种情况下始终更新它就好了
   */
  markStaticRoots(root, false);
}

/**
 * 匹配type,tag,attrsList,attrsMap,plain,parent,children,attrs +key 字符串
 * @param {*} keys
 * @returns
 */
function genStaticKeys(keys: string): Function {
  return makeMap(
    "type,tag,attrsList,attrsMap,plain,parent,children,attrs,start,end,rawAttrsMap" +
      (keys ? "," + keys : "")
  );
}

/**
 * 在所有节点上设置static属性， 用来标记是否为静态节点
 * 注意：如果有子节点为动态节点， 则父节点也被认为是动态节点
 * @param {*} node
 * @returns
 */
function markStatic(node: ASTNode) {
  /**通过node.isStatic来标识节点是否为静态节点 */
  node.static = isStatic(node);
  if (node.type === 1) {
    /**
     * do not make component slot content static. this avoids
     * 1. components not able to mutate slot nodes
     * 2. static slot content fails for hot-reloading
     *
     * 不要将组件的插槽内容设置为静态节点，这样可以避免
     *  1. 组件不能改变插槽节点
     *  2. 静态插槽内容在热重载时失败
     */

    if (
      !isPlatformReservedTag(node.tag) &&
      node.tag !== "slot" &&
      node.attrsMap["inline-template"] == null
    ) {
      /**递归终止条件，如果节点不是平台保留标签  && 也不是 slot 标签 && 也不是内联模版，则直接结束 */
      return;
    }
    /**遍历所有子节点，递归调用markStatic来标记这些子节点的static属性 */
    for (let i = 0, l = node.children.length; i < l; i++) {
      const child = node.children[i];
      markStatic(child);
      /**如果子节点是非静态节点，则将父节点更新为非静态节点 */
      if (!child.static) {
        node.static = false;
      }
    }
    /**如果节点存在 v-if、v-else-if、v-else 这些指令，则依次标记 block 中节点的 static */
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        const block = node.ifConditions[i].block;
        markStatic(block);
        if (!block.static) {
          node.static = false;
        }
      }
    }
  }
}

/**
 * 进一步标记静态根节点，一个节点要成为静态根节点，需要满足以下条件
 * 1. 节点本身是静态节点，而且有子节点，而且子节点不只是一个文本节点，则标记为静态根
 * 2. 静态根节点不能只有静态文本的子节点， 因为这样收益太低，这种情况下始终更新它就好了
 * @param {*} node 当前节点
 * @param {*} isInFor 当前节点是否被包裹在v-for指令所在的节点内
 * @returns
 */
function markStaticRoots(node: ASTNode, isInFor: boolean) {
  if (node.type === 1) {
    /**虚拟 dom 节点 */
    if (node.static || node.once) {
      /**
       * 节点是静态的或者节点上有v-once指令
       * 标记node.staticInFor = true or false
       */
      node.staticInFor = isInFor;
    }

    // For a node to qualify as a static root, it should have children that
    // are not just static text. Otherwise the cost of hoisting out will
    // outweigh the benefits and it's better off to just always render it fresh.
    if (
      node.static &&
      node.children.length &&
      !(node.children.length === 1 && node.children[0].type === 3)
    ) {
      /**
       * 节点本身是静态节点，而且有子节点，而且子节点不只是一个文本节点，则标记为静态根 => node.staticRoot = true，否则为非静态根
       */
      node.staticRoot = true;
      return;
    } else {
      node.staticRoot = false;
    }

    /**
     * 当前节点不是静态根节点的时候，递归遍历其子节点，标记静态根
     */
    if (node.children) {
      for (let i = 0, l = node.children.length; i < l; i++) {
        markStaticRoots(node.children[i], isInFor || !!node.for);
      }
    }

    /**
     * 如果节点存在 v-if、v-else-if、v-else 指令，则为 block 节点标记静态根
     */
    if (node.ifConditions) {
      for (let i = 1, l = node.ifConditions.length; i < l; i++) {
        markStaticRoots(node.ifConditions[i].block, isInFor);
      }
    }
  }
}

/**
 * 判断节点是否为静态节点
 *   1. 通过自定义的node.type 来判断， 2: 表达式 => 动态 3: 文本 => 静态
 *   2. 凡是有v-bind、 v-if、 v-for等指令的都属于动态节点
 *   3. 组件为动态节点
 *   4. 父节点为含有v-for指令的template标签， 则为动态节点
 * @param {*} node
 * @returns {boolean}
 */
function isStatic(node: ASTNode): boolean {
  if (node.type === 2) {
    // expression {{msg}} 表达式
    return false;
  }
  if (node.type === 3) {
    // text 文本内容 文本节点或者是空注释节点
    return true;
  }
  /**跳过这个元素和它的子元素的编译过程。可以用来显示原始 Mustache 标签。跳过大量没有指令的节点会加快编译。 遇到指令不需要编译成模板显示原始指令 */
  return !!(
    (
      node.pre /**标记 标签是否还有 v-pre 指令 ,如果有则为真*/ ||
      (!node.hasBindings /** 没有动态标记元素 */ && // no dynamic bindings
        !node.if &&
        !node.for /**ot v-if or v-for or v-else 没有 v-if 或者 v-for 或者 v-else */ && // not v-if or v-for or v-else
        !isBuiltInTag(node.tag) /**没有 slot,component*/ && // not a built-in
        isPlatformReservedTag(
          node.tag
        ) /**not a component 不是一个组件   保留标签 判断是不是真的是 html 原有的标签 或者svg标签*/ && // not a component
        !isDirectChildOfTemplateFor(
          node
        ) /** 判断当前ast 虚拟dom 的父标签 如果不是template则返回false，如果含有v-for则返回true */ &&
        Object.keys(node).every(isStaticKey))
    ) /**node的key必须每一项都符合   匹配type,tag,attrsList,attrsMap,plain,parent,children,attrs + staticKeys 的字符串 */
  );
}

/**
 *  判断当前ast 虚拟dom 的父标签 如果不是template则返回false，如果含有v-for则返回true
 * @param {*} node
 * @returns
 */
function isDirectChildOfTemplateFor(node: ASTElement): boolean {
  while (node.parent) {
    node = node.parent;
    if (node.tag !== "template") {
      /**不是template标签 */
      return false;
    }
    if (node.for) {
      /**含有v-for */
      return true;
    }
  }
  return false;
}
