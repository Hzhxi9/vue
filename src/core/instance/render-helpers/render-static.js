/* @flow */

/**
 * Runtime helper for rendering static trees.
 * 运行时负责生成静态树的 VNode 的帮助程序，完成了以下两件事
 *    1、执行 staticRenderFns 数组中指定下标的渲染函数（静态树的渲染函数），生成静态树的 VNode 并缓存，下次在渲染时从缓存中直接读取（isInFor 必须为 true）
 *    2、为静态树的 VNode 打静态标记
 * 
 *  _m(idx, true or '')
 *
 * @param {*} index 表示当前静态节点的渲染函数在 staticRenderFns 数组中的下标索引
 * @param {*} isInFor isInFor 表示当前静态节点是否被包裹在含有 v-for 指令的节点内部
 * @returns
 */
export function renderStatic(
  index: number,
  isInFor: boolean
): VNode | Array<VNode> {
  /** 缓存，静态节点第二次被渲染时就从缓存中直接获取已缓存的 VNode */
  const cached = this._staticTrees || (this._staticTrees = []);

  /**获取缓存里的结果  */
  let tree = cached[index];

  /**
   * if has already-rendered static tree and not inside v-for,we can reuse the same tree.
   * 如果当前静态树已经被渲染过一次（即有缓存）而且没有被包裹在 v-for 指令所在节点的内部，则直接返回缓存的 VNode
   **/
  if (tree && !isInFor) {
    return tree;
  }

  /**
   * otherwise, render a fresh tree.
   * 执行 staticRenderFns 数组中指定元素（静态树的渲染函数）生成该静态树的 VNode，并缓存
   */
  tree = cached[index] = this.$options.staticRenderFns[index].call(
    this._renderProxy,
    null,
    this // for render fns generated for functional component templates
  );

  /**静态标记，为静态树的 VNode 打标记，即添加 { isStatic: true, key: `__static__${index}`, isOnce: false } */
  markStatic(tree, `__static__${index}`, false);
  return tree;
}

/**
 * Runtime helper for v-once.
 * Effectively it means marking the node as static with a unique key.
 * @param {*} tree
 * @param {*} index
 * @param {*} key
 * @returns
 */
export function markOnce(
  tree: VNode | Array<VNode>,
  index: number,
  key: string
) {
  markStatic(tree, `__once__${index}${key ? `_${key}` : ``}`, true);
  return tree;
}

/**
 * 为 VNode 打静态标记，在 VNode 上添加三个属性：
 * { isStatic: true, key: xx, isOnce: true or false }
 * @param {*} tree
 * @param {*} key
 * @param {*} isOnce
 */
function markStatic(tree: VNode | Array<VNode>, key: string, isOnce: boolean) {
  if (Array.isArray(tree)) {
    /**
     *  tree 为 VNode 数组，循环遍历其中的每个 VNode，为每个 VNode 做静态标记
     */
    for (let i = 0; i < tree.length; i++) {
      if (tree[i] && typeof tree[i] !== "string") {
        markStaticNode(tree[i], `${key}_${i}`, isOnce);
      }
    }
  } else {
    markStaticNode(tree, key, isOnce);
  }
}

/**
 * 标记静态 VNode
 * @param {*} node
 * @param {*} key
 * @param {*} isOnce
 */
function markStaticNode(node, key, isOnce) {
  node.isStatic = true;
  node.key = key;
  node.isOnce = isOnce;
}
