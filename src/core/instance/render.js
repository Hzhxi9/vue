/* @flow */

import {
  warn,
  nextTick,
  emptyObject,
  handleError,
  defineReactive,
} from "../util/index";

import { createElement } from "../vdom/create-element";
import { installRenderHelpers } from "./render-helpers/index";
import { resolveSlots } from "./render-helpers/resolve-slots";
import { normalizeScopedSlots } from "../vdom/helpers/normalize-scoped-slots";
import VNode, { createEmptyVNode } from "../vdom/vnode";

import { isUpdatingChildComponent } from "./lifecycle";

export function initRender(vm: Component) {
  vm._vnode = null; // the root of the child tree
  vm._staticTrees = null; // v-once cached trees
  const options = vm.$options;
  const parentVnode = (vm.$vnode = options._parentVnode); // the placeholder node in parent tree
  const renderContext = parentVnode && parentVnode.context;
  vm.$slots = resolveSlots(options._renderChildren, renderContext);
  vm.$scopedSlots = emptyObject;
  // bind the createElement fn to this instance
  // so that we get proper render context inside it.
  // args order: tag, data, children, normalizationType, alwaysNormalize
  // internal version is used by render functions compiled from templates

  /**
   * 定义 _c，它是 createElement 的一个柯里化方法
   * @param {*} a 标签名
   * @param {*} b 属性的JSON字符串
   * @param {*} c 子节点数组
   * @param {*} d 节点的规范化类型
   * @returns VNode or Array<VNode>
   */
  vm._c = (a, b, c, d) => createElement(vm, a, b, c, d, false);

  // normalization is always applied for the public version, used in
  // user-written render functions.
  vm.$createElement = (a, b, c, d) => createElement(vm, a, b, c, d, true);

  // $attrs & $listeners are exposed for easier HOC creation.
  // they need to be reactive so that HOCs using them are always updated
  const parentData = parentVnode && parentVnode.data;

  /* istanbul ignore else */
  if (process.env.NODE_ENV !== "production") {
    defineReactive(
      vm,
      "$attrs",
      (parentData && parentData.attrs) || emptyObject,
      () => {
        !isUpdatingChildComponent && warn(`$attrs is readonly.`, vm);
      },
      true
    );
    defineReactive(
      vm,
      "$listeners",
      options._parentListeners || emptyObject,
      () => {
        !isUpdatingChildComponent && warn(`$listeners is readonly.`, vm);
      },
      true
    );
  } else {
    defineReactive(
      vm,
      "$attrs",
      (parentData && parentData.attrs) || emptyObject,
      null,
      true
    );
    defineReactive(
      vm,
      "$listeners",
      options._parentListeners || emptyObject,
      null,
      true
    );
  }
}

export let currentRenderingInstance: Component | null = null;

// for testing only
export function setCurrentRenderingInstance(vm: Component) {
  currentRenderingInstance = vm;
}

export function renderMixin(Vue: Class<Component>) {
  // install runtime convenience helpers

  /**
   * 在组件实例上挂载一些运行时需要用到的工具函数
   * 这些工具函数用在编译器生成的渲染函数中，比如 v-for 编译后的 vm._l，还有大家最熟悉的 h 函数（vm._c)，不过它没在这里声明，是在 initRender 函数中声明的。
   */
  installRenderHelpers(Vue.prototype);

  Vue.prototype.$nextTick = function (fn: Function) {
    return nextTick(fn, this);
  };

  /**
   * 通过执行 render 函数生成 VNode
   * 不过里面加了大量的异常处理代码
   * @returns
   */
  Vue.prototype._render = function (): VNode {
    const vm: Component = this;
    /**
     * 获取 render
     * 1. 用户实例化提供了render 配置项
     * 2. 编译器编译模板生成render
     */
    const { render, _parentVnode } = vm.$options;

    /**
     * 插槽
     */
    if (_parentVnode) {
      vm.$scopedSlots = normalizeScopedSlots(
        _parentVnode.data.scopedSlots,
        vm.$slots,
        vm.$scopedSlots
      );
    }

    // set parent vnode. this allows render functions to have access
    // to the data on the placeholder node.

    /**
     * 设置父 vnode。这使得渲染函数可以访问占位符节点上的数据。
     */
    vm.$vnode = _parentVnode;
    // render self
    let vnode;
    try {
      // There's no need to maintain a stack because all render fns are called
      // separately from one another. Nested component's render fns are called
      // when parent component is patched.
      currentRenderingInstance = vm;
      /**
       * 执行render 函数得到 组件的VNode
       */
      vnode = render.call(vm._renderProxy, vm.$createElement);
    } catch (e) {
      handleError(e, vm, `render`);
      // return error render result,
      // or previous vnode to prevent render error causing blank component
      /* istanbul ignore else */
      /**
       * 到这儿，说明执行 render 函数时出错了
       * 开发环境渲染错误信息，生产环境返回之前的 vnode，以防止渲染错误导致组件空白
       */
      if (process.env.NODE_ENV !== "production" && vm.$options.renderError) {
        try {
          vnode = vm.$options.renderError.call(
            vm._renderProxy,
            vm.$createElement,
            e
          );
        } catch (e) {
          handleError(e, vm, `renderError`);
          vnode = vm._vnode;
        }
      } else {
        vnode = vm._vnode;
      }
    } finally {
      currentRenderingInstance = null;
    }
    // if the returned array contains only a single node, allow it
    /**
     * 如果返回的 vnode 是数组，并且只包含了一个元素，则直接打平
     */
    if (Array.isArray(vnode) && vnode.length === 1) {
      vnode = vnode[0];
    }

    /**
     * 返回了多个根节点的异常提示，vue2 不支持多根节点
     */
    // return empty vnode in case the render function errored out
    if (!(vnode instanceof VNode)) {
      if (process.env.NODE_ENV !== "production" && Array.isArray(vnode)) {
        warn(
          "Multiple root nodes returned from render function. Render function " +
            "should return a single root node.",
          vm
        );
      }
      /**返回一个空节点 */
      vnode = createEmptyVNode();
    }
    // set parent
    vnode.parent = _parentVnode;
    return vnode;
  };
}
