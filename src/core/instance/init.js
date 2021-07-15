/* @flow */

import config from "../config";
import { initProxy } from "./proxy";
import { initState } from "./state";
import { initRender } from "./render";
import { initEvents } from "./events";
import { mark, measure } from "../util/perf";
import { initLifecycle, callHook } from "./lifecycle";
import { initProvide, initInjections } from "./inject";
import { extend, mergeOptions, formatComponentName } from "../util/index";

let uid = 0;

/**定义initMixin */
export function initMixin(Vue: Class<Component>) {
  /**Vue的初始化 */
  Vue.prototype._init = function (options?: Object) {
    /**Vue实例vm */
    const vm: Component = this;
    /**每个vue实例都有一个uid, 依次递增 */
    vm._uid = uid++;

    let startTag, endTag;
    /* istanbul ignore if */
    if (process.env.NODE_ENV !== "production" && config.performance && mark) {
      startTag = `vue-perf-start:${vm._uid}`;
      endTag = `vue-perf-end:${vm._uid}`;
      mark(startTag);
    }

    // a flag to avoid this being observed
    /**防止Vue实例vm自身被观察的标志位 */
    vm._isVue = true;
    // merge options

    /**处理组件配置项 */
    if (options && options._isComponent) {
      // optimize internal component instantiation
      // 优化内部组件实例化
      // since dynamic options merging is pretty slow, and none of the
      // 因为动态合并配置非常慢
      // internal component options needs special treatment.
      // 而且内部组件配置需要做特殊处理

      /**
       * 每个子组件初始化时进入这里，只做一些性能优化
       * 将组件配置对象上的一些深层次属性放到vm.$options中，提高代码执行效率
       */
      initInternalComponent(vm, options);
    } else {
      /**
       * 初始化根组件进入这里，合并Vue全局配置到根组件的局部配置
       * 比如Vue.component注册的全局组件到根实例的component选项中
       *
       * 每个子组件的选项合并合发生在两个地方
       * 1. Vue.component方法注册的全局组件在注册时做了选项合并
       * 2. { component： {xx} } 方式注册的局部组件在执行编译器生成的render函数时做了选项合并，包括根组件的components配置
       *
       */
      vm.$options = mergeOptions(
        resolveConstructorOptions(vm.constructor),
        options || {},
        vm
      );
    }
    /* istanbul ignore else */
    if (process.env.NODE_ENV !== "production") {
      /**
       * 设置代理，将vm实例上的属性代理到vm.renderProxy
       */
      initProxy(vm);
    } else {
      vm._renderProxy = vm;
    }
    // expose real self
    vm._self = vm;
    /**
     * 初始化生命周期
     * 即组件实例关系属性，比如$parent、$children、$root、$refs等
     */
    initLifecycle(vm);
    /**
     * 初始化自定义事件
     * 在<comp @click="handleClick" />上注册的事件
     * 监听不是父组件而是子组件本身
     * 也就是说事件的派发和监听者是子组件本身和父组件无关
     */
    initEvents(vm);
    /**
     * 初始化render渲染
     * 解析组件的slot信息，得到vm.$slot，处理渲染函数，得到vm.$createElement方法，即h函数
     */
    initRender(vm);
    /**
     * 调用beforeCreate钩子函数并且触发beforeCreate钩子函数
     */
    callHook(vm, "beforeCreate");
    /**
     *  resolve injections before data/props
     *  初始化组件的inject配置项，得到result[key]=val形式的配置对象
     *  然后对结果数据进行响应式处理
     *  并代理每个key到vm实例中
     */
    initInjections(vm);
    /**
     * 初始化props, methods, data, computed, watch
     * 数据响应式的重点
     */
    initState(vm);
    /**
     * 解析组件配置项上的provide对象，将其挂载到vm.provided属性上
     */
    initProvide(vm); // resolve provide after data/props
    /**
     * 调用create钩子函数
     */
    callHook(vm, "created");

    /* istanbul ignore if */
    if (process.env.NODE_ENV !== "production" && config.performance && mark) {
      /*格式化组件名*/
      vm._name = formatComponentName(vm, false);
      mark(endTag);
      measure(`vue ${vm._name} init`, startTag, endTag);
    }

    /**
     * 如果发现配置上有el选项
     * 则自动调用$mount方法
     *
     */
    if (vm.$options.el) {
      /**调用$mount, 进入挂载阶段 */
      vm.$mount(vm.$options.el);
    }
  };
}

export function initInternalComponent(
  vm: Component,
  options: InternalComponentOptions
) {
  const opts = (vm.$options = Object.create(vm.constructor.options));
  // doing this because it's faster than dynamic enumeration.
  // 这样做是因为它比动态枚举更快。
  const parentVnode = options._parentVnode;
  opts.parent = options.parent;
  opts._parentVnode = parentVnode;

  const vnodeComponentOptions = parentVnode.componentOptions;
  opts.propsData = vnodeComponentOptions.propsData;
  opts._parentListeners = vnodeComponentOptions.listeners;
  opts._renderChildren = vnodeComponentOptions.children;
  opts._componentTag = vnodeComponentOptions.tag;

  if (options.render) {
    opts.render = options.render;
    opts.staticRenderFns = options.staticRenderFns;
  }
}

/**
 * 从组件构造函数中解析配置函数options，并合并基类选项
 * @param {*} Ctor
 * @returns
 */
export function resolveConstructorOptions(Ctor: Class<Component>) {
  /**配置项目 */
  let options = Ctor.options;

  if (Ctor.super) {
    /**
     * 如果存在
     * 基类递归解析基类构造函数的选项
     **/
    const superOptions = resolveConstructorOptions(Ctor.super);
    const cachedSuperOptions = Ctor.superOptions;
    if (superOptions !== cachedSuperOptions) {
      /**
       * super option changed,need to resolve new options.
       * 说明基类构造函数选项已经发生改变，需要重新设置
       * */
      Ctor.superOptions = superOptions;
      /**
       *  check if there are any late-modified/attached options (#4976)
       *  检查Ctor.superOptions 上检查是否有任何后期修改/附加的选项
       **/
      const modifiedOptions = resolveModifiedOptions(Ctor);
      /**
       * update base extend options
       * 如果存在被修改或增加的选项，则合并两个选项
       */
      if (modifiedOptions) {
        extend(Ctor.extendOptions, modifiedOptions);
      }
      /**选项合并，将合并结果赋值为 Ctor.options */
      options = Ctor.options = mergeOptions(superOptions, Ctor.extendOptions);
      if (options.name) {
        options.components[options.name] = Ctor;
      }
    }
  }
  return options;
}

/**
 * 解析构造函数选项中后续被修改或者增加的选项
 * @param {*} Ctor
 * @returns
 */
function resolveModifiedOptions(Ctor: Class<Component>): ?Object {
  let modified;
  /**构造函数选项 */
  const latest = Ctor.options;
  /**密封的构造函数，备份 */
  const sealed = Ctor.sealedOptions;
  /**对比两个选项，记录不一致的选项 */
  for (const key in latest) {
    if (latest[key] !== sealed[key]) {
      if (!modified) modified = {};
      modified[key] = latest[key];
    }
  }
  return modified;
}
