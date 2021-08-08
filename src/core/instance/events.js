/* @flow */

import {
  tip,
  toArray,
  hyphenate,
  formatComponentName,
  invokeWithErrorHandling,
} from "../util/index";
import { updateListeners } from "../vdom/helpers/index";

export function initEvents(vm: Component) {
  vm._events = Object.create(null);
  vm._hasHookEvent = false;
  // init parent attached events
  const listeners = vm.$options._parentListeners;
  if (listeners) {
    updateComponentListeners(vm, listeners);
  }
}

let target: any;

function add(event, fn) {
  /**this.$on */
  target.$on(event, fn);
}

function remove(event, fn) {
  target.$off(event, fn);
}

function createOnceHandler(event, fn) {
  const _target = target;
  return function onceHandler() {
    const res = fn.apply(null, arguments);
    if (res !== null) {
      _target.$off(event, onceHandler);
    }
  };
}

export function updateComponentListeners(
  vm: Component,
  listeners: Object,
  oldListeners: ?Object
) {
  target = vm;
  updateListeners(
    listeners,
    oldListeners || {},
    add,
    remove,
    createOnceHandler,
    vm
  );
  target = undefined;
}

export function eventsMixin(Vue: Class<Component>) {
  const hookRE = /^hook:/;
  /**
   * 使用方式
   * this.$on('custom-click', function(){})
   *
   * <comp @custom-click="handleClick" />
   * 将所有的事件和对应的回调放到vm._events对象上 { event1: [cb1, cb2, cb3, ...], ... }
   *
   * 监听实例上的自定义事件， vm._event = { eventName: [fn1, ...], ...}
   * @param {*} event 单个的事件名称或者有多个事件名组成的数组
   * @param {*} fn 当event被触发时执行的回调函数
   * @returns
   */
  Vue.prototype.$on = function (
    event: string | Array<string>,
    fn: Function
  ): Component {
    const vm: Component = this;

    /**
     * 事件为数组的情况
     * event 时有多个事件名组成的数组， 则遍历这些事件，一次递归调用$on
     * this.$on([event1, event2, ...], function(){})
     */
    if (Array.isArray(event)) {
      for (let i = 0, l = event.length; i < l; i++) {
        /**调用$on */
        vm.$on(event[i], fn);
      }
    } else {
      /**
       * 比如如果存在vm._event['custom-click'] = []
       * 将注册的事件和回调以键值对的形式存储到 vm._event 对象中vm._event = { eventName: [fn1, ...] }
       * 一个事件可以设置多个响应函数
       * this.$on('custom-click', cb1)
       * this.$on('custom-click', cb2)
       * vm._event['custom-click'] = [cb1, cb2, cb3,...]
       */
      (vm._events[event] || (vm._events[event] = [])).push(fn);
      // optimize hook:event cost by using a boolean flag marked at registration
      // instead of a hash lookup

      /**
       * 使用方式
       * <comp @hook:mounted="handleHookMounted" />
       * 
       * hookEvent，提供了从外部为组件实例注入生命周期方法的机会
       * 比如从组件外部为组件的mounted方法注入额外的逻辑
       * 该能力结合callhook 方法实现
       */
      if (hookRE.test(event)) {
        /**
         * 设置为true， 标记当前组件实例存在hook event
         */
        vm._hasHookEvent = true;
      }
    }
    return vm;
  };

  /**
   * 先通过$on 添加事件， 然后在事件回调函数中先调用$off 移除事件监听， 在执行用户传递进来的回调函数
   * @param {*} event
   * @param {*} fn
   * @returns
   */
  Vue.prototype.$once = function (event: string, fn: Function): Component {
    const vm: Component = this;

    /**
     * 将用户传递进来的回调函数做了一层包装
     * 调用 $on, 只是$on的回调函数被特殊处理了，触发时，执行回调函数，
     * 先移除事件监听，然后执行设置的回调函数
     **/
    function on() {
      vm.$off(event, on);
      fn.apply(vm, arguments);
    }
    on.fn = fn;
    /**将包装函数作为事件的回调函数添加 */
    vm.$on(event, on);
    return vm;
  };

  /**
   * 移除vm._event 对象上指定事件(key)的指定回调函数
   *
   * 1. 没有提供参数，将vm._events = {}
   * 2. 提供了第一个事件参数， 表示vm._events[event] = null
   * 3. 提供了两个参数，表示移除指定事件的指定回调函数
   *
   * 操作通过$on 设置的vm._events 对象
   * @param {*} event
   * @param {*} fn
   * @returns
   */
  Vue.prototype.$off = function (
    event?: string | Array<string>,
    fn?: Function
  ): Component {
    const vm: Component = this;

    /**
     * all
     * 不传参数， 移除实例上所有事件监听器 => vm._events = {}
     */
    if (!arguments.length) {
      /**
       * 移除所有事件监听器 => vm._event = {}
       */
      vm._events = Object.create(null);
      return vm;
    }

    /**
     * array of events
     * 移除一些事件event = [event1, ...]， 遍历event数组， 递归调用vm.$off
     *
     * 事件是数组，就循环递归
     */
    if (Array.isArray(event)) {
      for (let i = 0, l = event.length; i < l; i++) {
        vm.$off(event[i], fn);
      }
      return vm;
    }

    /**
     * specific event
     * 除了vm.$off()之外, 最终都会走到这里，移除指定事件
     * 获取指定事件的回调函数
     **/
    const cbs = vm._events[event];
    /**回调函数不存在直接结束 */
    if (!cbs) {
      /**表示没有注册过该事件 */
      return vm;
    }
    /**没有传回调函数 */
    if (!fn) {
      /**
       * vm._events[event] = [cb1, cb2, cb3,...] = vm._events[event] = null
       * 没有提供fn回调函数， 则移除该事件的所有回调函数，vm._event[event] = null
       */
      vm._events[event] = null;
      return vm;
    }

    /**
     * specific handler
     * 移除指定事件的回调函数，就是从事件的回调数组中找到该回调函数，然后删除
     */
    let cb;
    let i = cbs.length;
    while (i--) {
      cb = cbs[i];
      if (cb === fn || cb.fn === fn) {
        cbs.splice(i, 1);
        break;
      }
    }
    return vm;
  };

  /**
   * 触发实例上指定事件， vm._event[event] => cbs => loop cbs => cb(args)
   * @param {*} event 事件名
   * @returns
   */
  Vue.prototype.$emit = function (event: string): Component {
    const vm: Component = this;

    if (process.env.NODE_ENV !== "production") {
      /**
       * js使用$on定义自定义事件时， 用驼峰命名
       * html使用$emit会将驼峰命名， 全部转换为小写， 这样两个事件名就不一致
       * <comp @customClick="handleClick" /> => <comp @customclick="handleClick" />
       * $on('customClick', function(){})
       *
       * 所以建议在使用多个字符时， 采用连字符的形式
       * <comp @custom-click="handleClick" />
       * $on('custom-click', function(){})
       */
      const lowerCaseEvent = event.toLowerCase();
      if (lowerCaseEvent !== event && vm._events[lowerCaseEvent]) {
        /**
         * HTML 属性不区分大小写，所以你不能使用 v-on 监听小驼峰形式的事件名（eventName），而应该使用连字符形式的事件名（event-name
         */
        tip(
          `Event "${lowerCaseEvent}" is emitted in component ` +
            `${formatComponentName(
              vm
            )} but the handler is registered for "${event}". ` +
            `Note that HTML attributes are case-insensitive and you cannot use ` +
            `v-on to listen to camelCase events when using in-DOM templates. ` +
            `You should probably use "${hyphenate(
              event
            )}" instead of "${event}".`
        );
      }
    }
    /**
     * 从vm._events 对象中获取指定事件的所有回调函数
     * 从 vm._event 对象上拿到当前事件的回调函数数组，并一次调用数组中的回调函数，并且传递提供的参数
     */

    let cbs = vm._events[event];
    if (cbs) {
      /**数组转换， 类数组转换为数组 */
      cbs = cbs.length > 1 ? toArray(cbs) : cbs;

      /**
       * this.$emit('custom-click', arg1, arg2 )
       * args = [arg1, arg2]
       **/
      const args = toArray(arguments, 1);
      const info = `event handler for "${event}"`;
      for (let i = 0, l = cbs.length; i < l; i++) {
        /**执行回调函数 */
        invokeWithErrorHandling(cbs[i], vm, args, vm, info);
      }
    }
    return vm;
  };
}
