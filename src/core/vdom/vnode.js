/* @flow */

export default class VNode {
  tag: string | void;
  data: VNodeData | void;
  children: ?Array<VNode>;
  text: string | void;
  elm: Node | void;
  ns: string | void;
  context: Component | void; // rendered in this component's scope
  key: string | number | void;
  componentOptions: VNodeComponentOptions | void;
  componentInstance: Component | void; // component instance
  parent: VNode | void; // component placeholder node

  // strictly internal
  raw: boolean; // contains raw HTML? (server only)
  isStatic: boolean; // hoisted static node
  isRootInsert: boolean; // necessary for enter transition check
  isComment: boolean; // empty comment placeholder?
  isCloned: boolean; // is a cloned node?
  isOnce: boolean; // is a v-once node?
  asyncFactory: Function | void; // async component factory function
  asyncMeta: Object | void;
  isAsyncPlaceholder: boolean;
  ssrContext: Object | void;
  fnContext: Component | void; // real context vm for functional nodes
  fnOptions: ?ComponentOptions; // for SSR caching
  devtoolsMeta: ?Object; // used to store functional render context for devtools
  fnScopeId: ?string; // functional scope id support
  /**
   * 创建一个标准的Vue VNode
   * @param {*} tag 当前节点的标签名
   * @param {*} data 当前节点对应的数据对象， 包含了具体的一些数据对象，是一个VNodeData类型， 可以参数VNodeData类型中的数据信息
   * @param {*} children 子节点，数组
   * @param {*} text 当前节点的文本
   * @param {*} elm 当前虚拟节点的的真实DOM
   * @param {*} context 编译作用域
   * @param {*} componentOptions 组件的options选项
   * @param {*} asyncFactory 异步工厂函数
   */
  constructor(
    tag?: string,
    data?: VNodeData,
    children?: ?Array<VNode>,
    text?: string,
    elm?: Node,
    context?: Component,
    componentOptions?: VNodeComponentOptions,
    asyncFactory?: Function
  ) {
    /**当前节点的标签名 */
    this.tag = tag;

    /**
     * 当前节点对应的对象，包含了具体的一些数据信息，
     * 是一个VNodeData类型，可以参考VNodeData类型中的数据信息
     */
    this.data = data;

    /*当前节点的子节点，是一个数组*/
    this.children = children;

    /*当前节点的文本*/
    this.text = text;

    /*当前虚拟节点对应的真实dom节点*/
    this.elm = elm;

    /*当前节点的名字空间*/
    this.ns = undefined;

    /*编译作用域 vm*/
    this.context = context;
    this.fnContext = undefined;
    this.fnOptions = undefined;
    this.fnScopeId = undefined;

    /*节点的key属性，被当作节点的标志，用以优化*/
    this.key = data && data.key;

    /*组件的option选项*/
    this.componentOptions = componentOptions;

    /*当前节点对应的组件的实例*/
    this.componentInstance = undefined;

    /**当前节点的父节点 */
    this.parent = undefined;

    /**
     * 简而言之就是是否为原生HTML或只是普通文本，
     * innerHTML的时候为true，textContent的时候为false
     **/
    this.raw = false;

    /**静态节点标志 */
    this.isStatic = false;

    /**是否作为跟节点插入 */
    this.isRootInsert = true;

    /**是否为注释节点 */
    this.isComment = false;

    /**是否为克隆节点 */
    this.isCloned = false;

    /**是否有v-once指令 */
    this.isOnce = false;

    /**异步工厂 */
    this.asyncFactory = asyncFactory;
    this.asyncMeta = undefined;
    this.isAsyncPlaceholder = false;
  }

  // DEPRECATED: alias for componentInstance for backwards compat.
  /* istanbul ignore next */
  get child(): Component | void {
    return this.componentInstance;
  }
}

/**
 * 创建一个空节点
 * @param {*} text 
 * @returns 
 */
export const createEmptyVNode = (text: string = "") => {
  const node = new VNode();
  node.text = text;
  node.isComment = true;
  return node;
};

/**
 * 创建一个文本节点
 * @param {*} val 
 * @returns 
 */
export function createTextVNode(val: string | number) {
  return new VNode(undefined, undefined, undefined, String(val));
}

// optimized shallow clone
// used for static nodes and slot nodes because they may be reused across
// multiple renders, cloning them avoids errors when DOM manipulations rely
// on their elm reference.
/**
 * 优化浅克隆
 * 用于静态节点和插槽节点，因为他们可以被复用
 * 多重渲染，克隆他们避免DOM操作依赖时的错误
 * @param {*} vnode 
 * @returns 
 */
export function cloneVNode(vnode: VNode): VNode {
  const cloned = new VNode(
    vnode.tag,
    vnode.data,
    // #7975
    // clone children array to avoid mutating original in case of cloning
    // a child.
    vnode.children && vnode.children.slice(),
    vnode.text,
    vnode.elm,
    vnode.context,
    vnode.componentOptions,
    vnode.asyncFactory
  );
  cloned.ns = vnode.ns; /**命名空间 */
  cloned.isStatic = vnode.isStatic;/**是否为静态节点 */
  cloned.key = vnode.key; /**key属性 */
  cloned.isComment = vnode.isComment; /**是否为注释标签 */
  cloned.fnContext = vnode.fnContext; /**函数上下文 */
  cloned.fnOptions = vnode.fnOptions; /**函数options选项 */
  cloned.fnScopeId = vnode.fnScopeId; /**函数范围id */
  cloned.asyncMeta = vnode.asyncMeta;
  cloned.isCloned = true;
  return cloned;
}
