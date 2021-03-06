/* @flow */

import VNode from "./vnode";
import { resolveConstructorOptions } from "core/instance/init";
import { queueActivatedComponent } from "core/observer/scheduler";
import { createFunctionalComponent } from "./create-functional-component";

import { warn, isDef, isUndef, isTrue, isObject } from "../util/index";

import {
  resolveAsyncComponent,
  createAsyncPlaceholder,
  extractPropsFromVNodeData,
} from "./helpers/index";

import {
  callHook,
  activeInstance,
  updateChildComponent,
  activateChildComponent,
  deactivateChildComponent,
} from "../instance/lifecycle";

import {
  isRecyclableComponent,
  renderRecyclableComponentTemplate,
} from "weex/runtime/recycle-list/render-component-template";

// inline hooks to be invoked on component VNodes during patch
/**
 * patch期间在组件VNode上调用内联钩子
 */
const componentVNodeHooks = {
  /**初始化 */
  init(vnode: VNodeWithData, hydrating: boolean): ?boolean {
    if (
      vnode.componentInstance &&
      !vnode.componentInstance._isDestroyed &&
      vnode.data.keepAlive
    ) {
      /**
       * 被keep-alive包裹的组件，触发更新虚拟比较
       * kept-alive components, treat as a patch
       */
      const mountedNode: any = vnode; // work around flow
      componentVNodeHooks.prepatch(mountedNode, mountedNode);
    } else {
      /**
       * 创建组件实例
       * 非keep-alive，或者子组件初始化时走这里
       * 即new vnode.componentOptions.Ctor(options) => 得到Vue组件实例
       */
      const child = (vnode.componentInstance = createComponentInstanceForVnode(
        vnode,
        activeInstance
      ));
      /**
       * 执行组件的$mount 方法，进入挂载阶段
       * 接下来就是通过编译得到render函数
       * 接着走挂载、patch，直到组件渲染到页面
       */
      child.$mount(hydrating ? vnode.elm : undefined, hydrating);
    }
  },

  /**
   * 更新VNode，用新的VNode配置更新旧的VNode上的各种属性
   * @param {*} oldVnode
   * @param {*} vnode
   */
  prepatch(oldVnode: MountedComponentVNode, vnode: MountedComponentVNode) {
    /**
     * 新VNode的组件配置项
     */
    const options = vnode.componentOptions;

    /**
     * 老VNode的组件实例
     */
    const child = (vnode.componentInstance = oldVnode.componentInstance);
    /**
     * 用vnode上的属性更新child上的各种属性
     */
    updateChildComponent(
      child,
      options.propsData, // updated props
      options.listeners, // updated listeners
      vnode, // new parent vnode
      options.children // new children
    );
  },

  /**
   * 执行组件的mounted声明周期钩子
   * @param {*} vnode
   */
  insert(vnode: MountedComponentVNode) {
    const { context, componentInstance } = vnode;
    /**如果组件未挂载，则调用mounted声明周期钩子 */
    if (!componentInstance._isMounted) {
      componentInstance._isMounted = true;
      callHook(componentInstance, "mounted");
    }

    /**处理keep-alive组件的异常情况 */
    if (vnode.data.keepAlive) {
      if (context._isMounted) {
        // vue-router#1212
        // During updates, a kept-alive component's child components may
        // change, so directly walking the tree here may call activated hooks
        // on incorrect children. Instead we push them into a queue which will
        // be processed after the whole patch process ended.
        queueActivatedComponent(componentInstance);
      } else {
        activateChildComponent(componentInstance, true /* direct */);
      }
    }
  },

  /**
   * 销毁组件
   *    1. 如果组件被keep-alive组件包裹，则使用组件失或， 不销毁组件实例，从而缓存组件的状态
   *    2. 如果组件没有被keep-alive包裹，则直接调用实例的$destroy方法销毁
   * @param {*} vnode
   */
  destroy(vnode: MountedComponentVNode) {
    /**
     * 从VNode上获取组件实例
     */
    const { componentInstance } = vnode;
    if (!componentInstance._isDestroyed) {
      /**
       * 如果组件实例没有被销毁
       */
      if (!vnode.data.keepAlive) {
        /**
         * 组件没有被keep-alive组件包裹，则直接调用$destroy方法销毁组件
         */
        componentInstance.$destroy();
      } else {
        /**
         * 负责让组件失活， 不销毁组件实例，从而缓存组件的状态
         */
        deactivateChildComponent(componentInstance, true /* direct */);
      }
    }
  },
};

const hooksToMerge = Object.keys(componentVNodeHooks);

/**
 * 创建组件的 VNode，
 *     1、函数式组件通过执行其 render 方法生成组件的 VNode
 *     2、普通组件通过 new VNode() 生成其 VNode，但是普通组件有一个重要操作是在 data.hook 对象上设置了四个钩子函数，
 *        分别是 init、prepatch、insert、destroy，在组件的 patch 阶段会被调用，
 *        比如 init 方法，调用时会进入子组件实例的创建挂载阶段，直到完成渲染
 * @param {*} Ctor 组件构造函数
 * @param {*} data 属性组成的 JSON 字符串
 * @param {*} context 上下文
 * @param {*} children 子节点数组
 * @param {*} tag 标签名
 * @returns VNode or Array<VNode>
 */
export function createComponent(
  Ctor: Class<Component> | Function | Object | void,
  data: ?VNodeData,
  context: Component,
  children: ?Array<VNode>,
  tag?: string
): VNode | Array<VNode> | void {
  /**组件构造函数不存在，直接结束 */
  if (isUndef(Ctor)) {
    return;
  }

  /**
   *  Vue.extend
   *  用来标识扩展所有普通对象的基构造函数
   */
  const baseCtor = context.$options._base;

  /**
   * plain options object: turn it into a constructor
   * 当 Ctor 为配置对象时，通过 Vue.extend 将其转为构造函数
   */
  if (isObject(Ctor)) {
    Ctor = baseCtor.extend(Ctor);
  }

  /**
   * 如果到这个为止，Ctor 仍然不是一个函数，则表示这是一个无效的组件定义
   * if at this stage it's not a constructor or an async component factory,reject.
   */
  if (typeof Ctor !== "function") {
    if (process.env.NODE_ENV !== "production") {
      warn(`Invalid Component definition: ${String(Ctor)}`, context);
    }
    return;
  }

  // async component 异步组件
  let asyncFactory;

  /**cid: 唯一标识符 */
  if (isUndef(Ctor.cid)) {
    asyncFactory = Ctor;

    /**解决异步组件，更新组件数据 */
    Ctor = resolveAsyncComponent(asyncFactory, baseCtor);
    if (Ctor === undefined) {
      /**为异步组件返回一个占位符节点，组件被渲染为注释节点，但保留了节点的所有原始信息，这些信息将用于异步服务器渲染 和 hydration */
      // return a placeholder node for async component, which is rendered
      // as a comment node but preserves all the raw information for the node.
      // the information will be used for async server-rendering and hydration.
      return createAsyncPlaceholder(asyncFactory, data, context, children, tag);
    }
  }

  /**节点的属性 JSON 字符串 */
  data = data || {};

  /**
   * 子组件做选项合并的地方
   * 这里其实就是组件做选项合并的地方，即编译器将组件编译为渲染函数，渲染时执行 render 函数，然后执行其中的 _c，就会走到这里了
   * 解析构造函数选项，并合基类选项，以防止在组件构造函数创建后应用全局混入
   * resolve constructor options in case global mixins are applied after
   * component constructor creation
   */
  resolveConstructorOptions(Ctor);

  /**
   * 将组件的 v-model 的信息（值和回调）转换为 data.attrs 对象的属性、值和 data.on 对象上的事件、回调
   * transform component v-model data into props & events
   */
  if (isDef(data.model)) {
    transformModel(Ctor.options, data);
  }

  /**
   * extract props
   * 提取 props 数据，得到 propsData 对象，propsData[key] = val
   * 以组件 props 配置中的属性为 key，父组件中对应的数据为 value
   */
  const propsData = extractPropsFromVNodeData(data, Ctor, tag);

  /**
   * functional component
   * 函数式组件
   */
  if (isTrue(Ctor.options.functional)) {
    /**
     * 执行函数式组件的 render 函数生成组件的 VNode，做了以下 3 件事：
     *  1、设置组件的 props 对象
     *  2、设置函数式组件的渲染上下文，传递给函数式组件的 render 函数
     *  3、调用函数式组件的 render 函数生成 vnode
     */
    return createFunctionalComponent(Ctor, propsData, data, context, children);
  }

  /**
   * 获取事件监听器对象 data.on，因为这些监听器需要作为子组件监听器处理，而不是 DOM 监听器
   * extract listeners, since these needs to be treated as
   * child component listeners instead of DOM listeners
   */
  const listeners = data.on;

  /**
   * 将带有 .native 修饰符的事件对象赋值给 data.on
   * replace with listeners with .native modifier
   * so it gets processed during parent component patch.
   */
  data.on = data.nativeOn;

  if (isTrue(Ctor.options.abstract)) {
    // work around flow
    /**
     * 如果是抽象组件，则值保留 props、listeners 和 slot
     * abstract components do not keep anything
     * other than props & listeners & slot
     */
    const slot = data.slot;
    data = {};
    if (slot) {
      data.slot = slot;
    }
  }

  /**
   * 走到这里， 说明当前组件是一个普通的自定义组件(不是函数式组件)
   * 在data.hook上安装了一些内置钩子
   *
   * 在组件的 data 对象上设置 hook 对象，
   * hook 对象增加四个属性，init、prepatch、insert、destroy，
   * 负责组件的创建、更新、销毁，这些方法在组件的 patch 阶段会被调用
   * install component management hooks onto the placeholder node
   */
  installComponentHooks(data);

  // return a placeholder vnode
  const name = Ctor.options.name || tag;

  /**实例化组件的 VNode，对于普通组件的标签名会比较特殊，vue-component-${cid}-${name} */
  const vnode = new VNode(
    `vue-component-${Ctor.cid}${name ? `-${name}` : ""}`,
    data,
    undefined,
    undefined,
    undefined,
    context,
    { Ctor, propsData, listeners, tag, children },
    asyncFactory
  );

  // Weex specific: invoke recycle-list optimized @render function for
  // extracting cell-slot template.
  // https://github.com/Hanks10100/weex-native-directive/tree/master/component
  /* istanbul ignore if */
  if (__WEEX__ && isRecyclableComponent(vnode)) {
    return renderRecyclableComponentTemplate(vnode);
  }

  return vnode;
}

/**
 * new vnode.componentOptions.Ctor(options) => 得到Vue组件实例
 * @param {*} vnode
 * @param {*} parent
 * @returns
 */
export function createComponentInstanceForVnode(
  // we know it's MountedComponentVNode but flow doesn't
  vnode: any,
  // activeInstance in lifecycle state
  parent: any
): Component {
  const options: InternalComponentOptions = {
    _isComponent: true,
    _parentVnode: vnode,
    parent,
  };
  // check inline-template render functions
  /**
   * 检查内联模板渲染函数
   */
  const inlineTemplate = vnode.data.inlineTemplate;
  if (isDef(inlineTemplate)) {
    options.render = inlineTemplate.render;
    options.staticRenderFns = inlineTemplate.staticRenderFns;
  }
  /**
   * new 组件构造函数， 得到组件实例
   * new VueComponent(options) => Vue实例
   **/
  return new vnode.componentOptions.Ctor(options);
}

/**
 * 在组件的 data 对象上设置 hook 对象，
 * hook 对象增加四个属性，init、prepatch、insert、destroy，
 * 负责组件的创建、更新、销毁，这些方法在组件的 patch 阶段会被调用
 * install component management hooks onto the placeholder node
 */
function installComponentHooks(data: VNodeData) {
  /**
   * 定义data.hook对象
   */
  const hooks = data.hook || (data.hook = {});
  /**
   * 遍历hookToMerge数组
   * hooksToMerge = ['init', 'prepatch', 'insert', 'destroy' ]
   */
  for (let i = 0; i < hooksToMerge.length; i++) {
    /**
     * 获取key，比如key = init
     */
    const key = hooksToMerge[i];
    /**
     * 获取用户传递的init方法， 从data.hook对象中获取key对应的方法
     */
    const existing = hooks[key];
    /**
     * componentVNodeHooks对象中key对象的方法，内置的init方法
     */
    const toMerge = componentVNodeHooks[key];

    /**
     * 合并用户传递的hook方法和框架自带的hook方法，其实就是分别执行两个方法
     */
    if (existing !== toMerge && !(existing && existing._merged)) {
      hooks[key] = existing ? mergeHook(toMerge, existing) : toMerge;
    }
  }
}

function mergeHook(f1: any, f2: any): Function {
  const merged = (a, b) => {
    // flow complains about extra args which is why we use any
    f1(a, b);
    f2(a, b);
  };
  merged._merged = true;
  return merged;
}

/**
 * 将组件的 v-model 的信息（值和回调）转换为 data.attrs 对象的属性、值和 data.on 对象上的事件、回调
 * transform component v-model info (value and callback) into
 * prop and event handler respectively.
 *
 *
 * v-model => value, input
 * 转换v-model, 得到
 * data.attrs[props] = val,
 * data.on[eventName] = [cb]
 * @param {*} options
 * @param {*} data
 */
function transformModel(options, data: any) {
  /**model 的属性和事件，默认为 value 和 input */

  /**
   * 处理属性值， 在data.attrs[props] = data.model.val
   */
  const prop = (options.model && options.model.prop) || "value";
  const event = (options.model && options.model.event) || "input";

  /** 在 data.attrs 对象上存储 v-model 的值 */
  (data.attrs || (data.attrs = {}))[prop] = data.model.value;

  /**
   * 在 data.on 对象上存储 v-model 的事件
   * 处理事件，结果为data.on = {eventName: [cb1, cb2, ...] }
   **/
  const on = data.on || (data.on = {});

  /**已存在的事件回调函数 */
  const existing = on[event];

  /**v-model 中事件对应的回调函数 */
  const callback = data.model.callback;

  /**合并回调函数 */
  if (isDef(existing)) {
    if (
      Array.isArray(existing)
        ? existing.indexOf(callback) === -1
        : existing !== callback
    ) {
      on[event] = [callback].concat(existing);
    }
  } else {
    on[event] = callback;
  }
}
