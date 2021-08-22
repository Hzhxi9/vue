/* @flow */

import VNode, { cloneVNode } from "./vnode";
import { createElement } from "./create-element";
import { resolveInject } from "../instance/inject";
import { normalizeChildren } from "../vdom/helpers/normalize-children";
import { resolveSlots } from "../instance/render-helpers/resolve-slots";
import { normalizeScopedSlots } from "../vdom/helpers/normalize-scoped-slots";
import { installRenderHelpers } from "../instance/render-helpers/index";

import {
  isDef,
  isTrue,
  hasOwn,
  camelize,
  emptyObject,
  validateProp,
} from "../util/index";

/**
 * 添加虚拟DOM，属性data，添加事件，添加props属性，parent属性，添加injections属性
 * 添加slots插槽渲染方法， 重写 this._c(createElement)函数， 渲染VNode
 * 安装渲染函数到FunctionalRenderContext.prototype 原型中， 这样该对象和Vue有着同样的渲染功能
 *
 *
 * @param {*} data VNode 虚拟DOM的属性数据
 * @param {*} props props 属性 包含值和key
 * @param {*} children 子节点
 * @param {*} parent vm vue实例化，如果parent也组件 也可能是VueComponent 构造函数 实例化的对象
 * @param {*} Ctor VueComponent 构造函数
 */
export function FunctionalRenderContext(
  data: VNodeData,
  props: Object,
  children: ?Array<VNode>,
  parent: Component,
  Ctor: Class<Component>
) {
  const options = Ctor.options;

  /**
   * ensure the createElement function in functional components
   * gets a unique context - this is necessary for correct named slot check
   * 确保函数组件中的createElement函数功能
   * 获取唯一上下文——这对于正确的命名槽检查是必要的
   */
  let contextVm;
  if (hasOwn(parent, "_uid")) {
    /**
     * 判断这个组件是否被初始化过(new _init)
     */
    contextVm = Object.create(parent);
    // $flow-disable-line
    contextVm._original = parent;
  } else {
    // the context vm passed in is a functional context as well.
    // in this case we want to make sure we are able to get a hold to the
    // real context instance.
    contextVm = parent;
    // $flow-disable-line
    parent = parent._original;
  }

  /**判断是否是模板编译 */
  const isCompiled = isTrue(options._compiled);

  /**如果不是模板编译 */
  const needNormalization = !isCompiled;

  this.data = data;
  this.props = props;
  this.children = children;
  this.parent = parent;
  this.listeners = data.on || emptyObject; /**事件 */

  /**
   * inject 选项应该是一个字符串数组或一个对象
   * 该对象的key代表本地绑定的名称
   * value为其key(String 或者 Symbol)对应的值
   */
  this.injections = resolveInject(options.inject, parent);

  /**插槽处理 */
  this.slots = () => {
    if (!this.$slots) {
      normalizeScopedSlots(
        data.scopedSlots,
        /**判断children 有没有分发式插槽 并且过滤掉空的插槽 */
        (this.$slots = resolveSlots(children, parent))
      );
    }
    return this.$slots;
  };

  Object.defineProperty(
    this,
    "scopedSlots",
    ({
      enumerable: true,
      get() {
        return normalizeScopedSlots(data.scopedSlots, this.slots());
      },
    }: any)
  );

  /**
   * support for compiled functional template
   * 支持编译的函数模板
   */
  if (isCompiled) {
    // exposing $options for renderStatic()
    this.$options = options;
    // pre-resolve slots for renderSlot()
    this.$slots = this.slots();
    this.$scopedSlots = normalizeScopedSlots(data.scopedSlots, this.$slots);
  }

  if (options._scopeId) {
    this._c = (a, b, c, d) => {
      /**创建子节点 */
      const vnode = createElement(contextVm, a, b, c, d, needNormalization);
      if (vnode && !Array.isArray(vnode)) {
        vnode.fnScopeId = options._scopeId;
        vnode.fnContext = parent;
      }
      return vnode;
    };
  } else {
    this._c = (a, b, c, d) =>
      createElement(contextVm, a, b, c, d, needNormalization);
  }
}

/*安装渲染帮助函数 */
installRenderHelpers(FunctionalRenderContext.prototype);

/**
 * 执行函数式组件的render函数生成组件的VNode， 做以下三件事
 *      1. 解析设置组件的props对象
 *      2. 设置函数式组件的渲染上下文，传递给函数式组件的render函数
 *      3. 调用函数式组件的render函数生成VNode，然后返回
 *
 * @param {*} Ctor 组件的构造函数
 * @param {*} propsData 额外的props对象
 * @param {*} data 节点属性组成的JSON字符串
 * @param {*} contextVm 上下文
 * @param {*} children 子节点数据
 * @returns VNode or Array<VNode>
 */
export function createFunctionalComponent(
  Ctor: Class<Component>,
  propsData: ?Object,
  data: VNodeData,
  contextVm: Component,
  children: ?Array<VNode>
): VNode | Array<VNode> | void {
  /**组件配置项 */
  const options = Ctor.options;

  /**获取props对象 */
  const props = {};

  /**组件本身的props选项 */
  const propOptions = options.props;

  /**设置函数式组件的props对象 */
  if (isDef(propOptions)) {
    /**
     * 显示提供了props配置
     * 遍历props配置， 从propsData对象中获取指定属性的值
     * props[key] = propsData[key]
     *
     * 说明该函数式组件本身提供了props选项
     * 则将props.key的值设置为组件上传递下来的对应key的值
     */
    for (const key in propOptions) {
      props[key] = validateProp(key, propOptions, propsData || emptyObject);
    }
  } else {
    /**
     * 当前函数式组件没有提供props选项
     * 则将组件上的attribute自动解析为props
     */
    if (isDef(data.attrs)) mergeProps(props, data.attrs);
    if (isDef(data.props)) mergeProps(props, data.props);
  }

  /**
   * 实例化函数式组件的渲染上下文
   */
  const renderContext = new FunctionalRenderContext(
    data,
    props,
    children,
    contextVm,
    Ctor
  );

  /**
   * 调用render函数，生成VNode，并给render函数传递_c 和渲染上下文
   */
  const vnode = options.render.call(null, renderContext._c, renderContext);

  /**
   * 在最后生成VNode对象上加一些标记，
   * 表示给VNode是一个函数式组件生成的，最后返回VNode
   */
  if (vnode instanceof VNode) {
    return cloneAndMarkFunctionalResult(
      vnode,
      data,
      renderContext.parent,
      options,
      renderContext
    );
  } else if (Array.isArray(vnode)) {
    const vnodes = normalizeChildren(vnode) || [];
    const res = new Array(vnodes.length);
    for (let i = 0; i < vnodes.length; i++) {
      res[i] = cloneAndMarkFunctionalResult(
        vnodes[i],
        data,
        renderContext.parent,
        options,
        renderContext
      );
    }
    return res;
  }
}

/**
 * 克隆并标记函数结果
 * @param {*} vnode VNode 虚拟DOM
 * @param {*} data 属性数据
 * @param {*} contextVm vm
 * @param {*} options 扩展函数
 * @param {*} renderContext 
 * @returns 
 */
function cloneAndMarkFunctionalResult(
  vnode,
  data,
  contextVm,
  options,
  renderContext
) {
  // #7817 clone node before setting fnContext, otherwise if the node is reused
  // (e.g. it was from a cached normal slot) the fnContext causes named slots
  // that should not be matched to match.
  const clone = cloneVNode(vnode);
  clone.fnContext = contextVm;
  clone.fnOptions = options;
  if (process.env.NODE_ENV !== "production") {
    (clone.devtoolsMeta = clone.devtoolsMeta || {}).renderContext =
      renderContext;
  }
  if (data.slot) {
    (clone.data || (clone.data = {})).slot = data.slot;
  }
  return clone;
}

/**
 * 拷贝合并props属性，并且把form的key由连字符写法变为驼峰写法
 * @param {*} to 
 * @param {*} from 
 */
function mergeProps(to, from) {
  for (const key in from) {
    to[camelize(key)] = from[key];
  }
}
