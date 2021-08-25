/* @flow */

import config from "../config";
import Watcher from "../observer/watcher";
import { mark, measure } from "../util/perf";
import { createEmptyVNode } from "../vdom/vnode";
import { updateComponentListeners } from "./events";
import { resolveSlots } from "./render-helpers/resolve-slots";
import { toggleObserving } from "../observer/index";
import { pushTarget, popTarget } from "../observer/dep";

import {
  warn,
  noop,
  remove,
  emptyObject,
  validateProp,
  invokeWithErrorHandling,
} from "../util/index";

export let activeInstance: any = null;
export let isUpdatingChildComponent: boolean = false;

export function setActiveInstance(vm: Component) {
  const prevActiveInstance = activeInstance;
  activeInstance = vm;
  return () => {
    activeInstance = prevActiveInstance;
  };
}

export function initLifecycle(vm: Component) {
  const options = vm.$options;

  // locate first non-abstract parent
  let parent = options.parent;
  if (parent && !options.abstract) {
    while (parent.$options.abstract && parent.$parent) {
      parent = parent.$parent;
    }
    parent.$children.push(vm);
  }

  vm.$parent = parent;
  vm.$root = parent ? parent.$root : vm;

  vm.$children = [];
  vm.$refs = {};

  vm._watcher = null;
  vm._inactive = null;
  vm._directInactive = false;
  vm._isMounted = false;
  vm._isDestroyed = false;
  vm._isBeingDestroyed = false;
}

export function lifecycleMixin(Vue: Class<Component>) {
  /**
   * 组件初次渲染和更新的入口
   * 负责更新页面，页面首次渲染和后续更新的入口位置，也是patch的入口位置
   * @param {*} vnode
   * @param {*} hydrating
   */
  Vue.prototype._update = function (vnode: VNode, hydrating?: boolean) {
    const vm: Component = this;

    /**页面挂载点， 真实元素 */
    const prevEl = vm.$el;

    /**旧VNode */
    const prevVnode = vm._vnode;
    const restoreActiveInstance = setActiveInstance(vm);

    /**新VNode */
    vm._vnode = vnode;

    // Vue.prototype.__patch__ is injected in entry points
    // based on the rendering backend used.
    if (!prevVnode /**旧VNode */) {
      /**
       * initial render 初次渲染，即初始化页面时走这里
       * patch 阶段， patch、diff算法
       *
       * 旧 VNode 不存在，表示首次渲染，即初始化页面时走这里
       */
      vm.$el = vm.__patch__(vm.$el, vnode, hydrating, false /* removeOnly */);
    } else {
      /**
       * updates 更新阶段，响应式数据更新时，即更新页面时走这里
       * 响应式数据更新时，即更新页面时走这里
       */
      vm.$el = vm.__patch__(prevVnode, vnode);
    }
    restoreActiveInstance();
    // update __vue__ reference
    if (prevEl) {
      prevEl.__vue__ = null;
    }

    /**更新__vue__ */
    if (vm.$el) {
      vm.$el.__vue__ = vm;
    }
    // if parent is an HOC, update its $el as well
    if (vm.$vnode && vm.$parent && vm.$vnode === vm.$parent._vnode) {
      vm.$parent.$el = vm.$el;
    }
    // updated hook is called by the scheduler to ensure that children are
    // updated in a parent's updated hook.
  };

  /**
   * 迫使 Vue 实例重新渲染。注意它仅仅影响实例本身和插入插槽内容的子组件，而不是所有子组件。
   * 只影响当前组件实例， 以及组件内的插槽内容
   */
  Vue.prototype.$forceUpdate = function () {
    const vm: Component = this;
    if (vm._watcher) {
      vm._watcher.update();
    }
  };

  /**
   * 完全销毁一个实例。清理它与其它实例的连接，解绑它的全部指令及事件监听器。
   * 触发 beforeDestroy 和 destroyed 的钩子。
   * @returns
   */
  Vue.prototype.$destroy = function () {
    const vm: Component = this;

    if (vm._isBeingDestroyed) {
      /**已经被销毁了，直接结束 */
      return;
    }

    /**销毁阶段开始，调用 beforeDestroy 钩子 */
    callHook(vm, "beforeDestroy");

    vm._isBeingDestroyed = true;

    // remove self from parent
    const parent = vm.$parent;

    /**从自己从父组件的children属性中移除 */
    if (parent && !parent._isBeingDestroyed && !vm.$options.abstract) {
      remove(parent.$children, vm);
    }

    /**
     * teardown watchers
     * watcher移除， 移除依赖监听
     **/
    if (vm._watcher) {
      vm._watcher.teardown();
    }

    let i = vm._watchers.length;
    while (i--) {
      vm._watchers[i].teardown();
    }
    // remove reference from data ob
    // frozen object may not have observer.
    if (vm._data.__ob__) {
      vm._data.__ob__.vmCount--;
    }
    // call the last hook...
    vm._isDestroyed = true;
    // invoke destroy hooks on current rendered tree
    /**
     * 更新页面
     * 将整个页面渲染为空， 销毁节点
     */
    vm.__patch__(vm._vnode, null);

    /**
     * fire destroyed hook
     * 调用 destroyed 钩子
     */
    callHook(vm, "destroyed");

    /**
     * turn off all instance listeners.
     * 移除当前组件所有事件监听器
     */
    vm.$off();

    // remove __vue__ reference
    if (vm.$el) {
      vm.$el.__vue__ = null;
    }

    // release circular reference (#6759)
    /**释放循环引用， 销毁父节点 */
    if (vm.$vnode) {
      /**断开与父组件的联系 */
      vm.$vnode.parent = null;
    }
  };
}

export function mountComponent(
  vm: Component,
  el: ?Element,
  hydrating?: boolean
): Component {
  vm.$el = el;
  if (!vm.$options.render) {
    /**
     * 没有渲染函数， 创建一个空的组件
     */
    vm.$options.render = createEmptyVNode;
    if (process.env.NODE_ENV !== "production") {
      /* istanbul ignore if */
      if (
        (vm.$options.template && vm.$options.template.charAt(0) !== "#") ||
        vm.$options.el ||
        el
      ) {
        warn(
          "You are using the runtime-only build of Vue where the template " +
            "compiler is not available. Either pre-compile the templates into " +
            "render functions, or use the compiler-included build.",
          vm
        );
      } else {
        warn(
          "Failed to mount component: template or render function not defined.",
          vm
        );
      }
    }
  }

  /**执行声明周期beforeMount */
  callHook(vm, "beforeMount");

  let updateComponent;
  /* istanbul ignore if */
  if (process.env.NODE_ENV !== "production" && config.performance && mark) {
    updateComponent = () => {
      const name = vm._name;
      const id = vm._uid;
      const startTag = `vue-perf-start:${id}`;
      const endTag = `vue-perf-end:${id}`;

      mark(startTag);
      const vnode = vm._render();
      mark(endTag);
      measure(`vue ${name} render`, startTag, endTag);

      mark(startTag);
      vm._update(vnode, hydrating);
      mark(endTag);
      measure(`vue ${name} patch`, startTag, endTag);
    };
  } else {
    /**
     * 负责更新组件
     */
    updateComponent = () => {
      /**
       * 执行_update进入更新阶段
       * 首先执行_render， 将组件变成VNode
       *
       * render是虚拟dom需要执行的编译函数
       * (function anonymous( ) {
       *      with(this){return _c('div',{attrs:{"id":"app"}},[_c('input',{directives:[{name:"info",rawName:"v-info"},{name:"data",rawName:"v-data"}],attrs:{"type":"text"}}),_v(" "),_m(0)])}
       * })
       *
       * 执行 vm._render() 函数，得到 VNode，并将 VNode 传递给 _update 方法，接下来就该到 patch 阶段了
       */
      vm._update(vm._render(), hydrating);
    };
  }

  // we set this to vm._watcher inside the watcher's constructor
  // since the watcher's initial patch may call $forceUpdate (e.g. inside child
  // component's mounted hook), which relies on vm._watcher being already defined

  new Watcher(
    vm,
    /**数据绑定完之后回调该函数。更新组件函数 更新 view试图 */
    updateComponent,
    noop,
    {
      before() {
        if (vm._isMounted && !vm._isDestroyed) {
          callHook(vm, "beforeUpdate");
        }
      },
    },
    true /* isRenderWatcher */
  );
  hydrating = false;

  // manually mounted instance, call mounted on self
  // mounted is called for render-created child components in its inserted hook
  if (vm.$vnode == null) {
    vm._isMounted = true;
    callHook(vm, "mounted");
  }
  return vm;
}

/**
 * 更新子组件，循环props，把他们添加到观察者中，更新事件
 * @param {*} vm 虚拟DOM
 * @param {*} propsData props 数据属性
 * @param {*} listeners 事件
 * @param {*} parentVnode 父节点
 * @param {*} renderChildren
 */
export function updateChildComponent(
  vm: Component,
  propsData: ?Object,
  listeners: ?Object,
  parentVnode: MountedComponentVNode,
  renderChildren: ?Array<VNode>
) {
  if (process.env.NODE_ENV !== "production") {
    /**标记 是否已经更新过了子组件 */
    isUpdatingChildComponent = true;
  }

  // determine whether component has slot children
  // we need to do this before overwriting $options._renderChildren.

  // check if there are dynamic scopedSlots (hand-written or compiled but with
  // dynamic slot names). Static scoped slots compiled from template has the
  // "$stable" marker.
  const newScopedSlots = parentVnode.data.scopedSlots;
  const oldScopedSlots = vm.$scopedSlots;
  const hasDynamicScopedSlot = !!(
    (newScopedSlots && !newScopedSlots.$stable) ||
    (oldScopedSlots !== emptyObject && !oldScopedSlots.$stable) ||
    (newScopedSlots && vm.$scopedSlots.$key !== newScopedSlots.$key) ||
    (!newScopedSlots && vm.$scopedSlots.$key)
  );

  // Any static slot children from the parent may have changed during parent's
  // update. Dynamic scoped slots may also have changed. In such cases, a forced
  // update is necessary to ensure correctness.
  const needsForceUpdate = !!(
    renderChildren || // has new static slots
    vm.$options._renderChildren || // has old static slots
    hasDynamicScopedSlot
  );

  /**父节点 */
  vm.$options._parentVnode = parentVnode;
  /**无需重新渲染即可更新vm的占位符节点 */
  vm.$vnode = parentVnode; // update vm's placeholder node without re-render

  if (vm._vnode) {
    // update child tree's parent
    vm._vnode.parent = parentVnode;
  }
  vm.$options._renderChildren = renderChildren;

  // update $attrs and $listeners hash
  // these are also reactive so they may trigger child update if the child
  // used them during render
  vm.$attrs = parentVnode.data.attrs || emptyObject; /**虚拟DOM的属性 */
  vm.$listeners = listeners || emptyObject; /**虚拟DOM的事件 */

  // update props
  if (propsData && vm.$options.props) {
    /**标识是否禁止还是添加观察者模式 */
    toggleObserving(false);

    /**获取props属性 */
    const props = vm._props;

    /**获取属性的props的key */
    const propKeys = vm.$options._propKeys || [];

    /**循环props属性 */
    for (let i = 0; i < propKeys.length; i++) {
      /**获取props单个属性的key */
      const key = propKeys[i];

      const propOptions: any = vm.$options.props; // wtf flow?

      /**
       * 验证支柱  验证 props 是否是规范数据 并且为props 添加 value.__ob__  属性，把props添加到观察者中
       * 校验props参数，就是组件定义的props类型数据，校验类型
       *
       * 判断prop.type的类型是不是Boolean或者String
       * 如果不是他们两类型，调用getPropDefaultValue获取默认值并且把value添加到观察者模式中
       */
      props[key] = validateProp(key, propOptions, propsData, vm);
    }
    toggleObserving(true);
    // keep a copy of raw propsData
    vm.$options.propsData = propsData;
  }

  // update listeners
  listeners = listeners || emptyObject;
  /**旧事件 */
  const oldListeners = vm.$options._parentListeners;
  /**新事件 */
  vm.$options._parentListeners = listeners;
  /**更新组件事件 */
  updateComponentListeners(vm, listeners, oldListeners);

  // resolve slots + force update if has children
  /**解决插槽+强制更新如果有 子节点 */
  if (needsForceUpdate) {
    /**判断children 有没有分发式插槽 并且过滤掉空的插槽,并且收集插槽 */
    vm.$slots = resolveSlots(renderChildren, parentVnode.context);
    /**更新数据 */
    vm.$forceUpdate();
  }

  if (process.env.NODE_ENV !== "production") {
    isUpdatingChildComponent = false;
  }
}

/**
 * 循环父节点， 如果有不活跃的返回真
 * @param {*} vm
 * @returns
 */
function isInInactiveTree(vm) {
  while (vm && (vm = vm.$parent)) {
    /**循环父节点如果父节点有_inactive 则返回true */
    if (vm._inactive) return true;
  }
  return false;
}

/**
 * 判断是否有不活跃的组件
 * 如果有活跃组件则触发钩子函数activated
 * @param {*} vm
 * @param {*} direct
 * @returns
 */
export function activateChildComponent(vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = false;
    if (isInInactiveTree(vm)) {
      /**存在不活跃树或者被禁用的组件 */
      return;
    }
  } else if (vm._directInactive) {
    /**单个不活跃 */
    return;
  }
  if (vm._inactive || vm._inactive === null) {
    vm._inactive = false;
    for (let i = 0; i < vm.$children.length; i++) {
      /**循环禁止子组件 */
      activateChildComponent(vm.$children[i]);
    }
    callHook(vm, "activated");
  }
}

/**
 * 循环子组件 和父组件  判断是否有禁止的组件 如果有活跃组件则执行生命后期函数deactivated
 */
export function deactivateChildComponent(vm: Component, direct?: boolean) {
  if (direct) {
    vm._directInactive = true;
    if (isInInactiveTree(vm)) {
      return;
    }
  }
  if (!vm._inactive) {
    /**如果该组件是活跃的 */
    vm._inactive = true; /**设置活动中的树 */
    for (let i = 0; i < vm.$children.length; i++) {
      deactivateChildComponent(vm.$children[i]);
    }
    callHook(vm, "deactivated");
  }
}
/**
 * callHook(vm, 'mounted')
 * 执行实例指定的生命周期钩子函数
 * 如果实例设置有对应的Hook Event，
 * 比如<comp @hook:mounted="method" />执行完生命周期函数之后，触发该时间的执行
 * @param {*} vm 组件实例
 * @param {*} hook 生命周期钩子函数
 */
export function callHook(vm: Component, hook: string) {
  // #7573 disable dep collection when invoking lifecycle hooks
  /**
   * 打开依赖收集
   */
  pushTarget();
  /**
   * 从实例配置对象中获取指定的钩子函数，比如mounted
   */
  const handlers = vm.$options[hook];
  /**
   * mounted hook
   */
  const info = `${hook} hook`;
  if (handlers) {
    /**
     * 通过 invokeWithErrorHandling 执行生命周期钩子
     */
    for (let i = 0, j = handlers.length; i < j; i++) {
      invokeWithErrorHandling(handlers[i], vm, null, vm, info);
    }
  }
  /**
   * Hook Event，如果设置了Hook Event，比如<comp @hook:mounted="method" />， 则通过$emit 触发该事件
   * vm._hasHookEvent 标识组件是否hook event， 这是在 vm.$on 中处理组件自定义事件时设置的
   */
  if (vm._hasHookEvent) {
    /**vm.$emit('hook:mounted') */
    vm.$emit("hook:" + hook);
  }

  /**
   * 关闭依赖收集
   */
  popTarget();
}
