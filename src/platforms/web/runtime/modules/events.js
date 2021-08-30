/* @flow */

import { isDef, isUndef } from "shared/util";
import { updateListeners } from "core/vdom/helpers/index";
import { isIE, isFF, supportsPassive, isUsingMicroTask } from "core/util/index";
import {
  RANGE_TOKEN,
  CHECKBOX_RADIO_TOKEN,
} from "web/compiler/directives/model";
import { currentFlushTimestamp } from "core/observer/scheduler";

// normalize v-model event tokens that can only be determined at runtime.
// it's important to place the event as the first in the array because
// the whole point is ensuring the v-model callback gets called before
// user-attached handlers.
function normalizeEvents(on) {
  /* istanbul ignore if */
  if (isDef(on[RANGE_TOKEN])) {
    // IE input[type=range] only supports `change` event
    const event = isIE ? "change" : "input";
    on[event] = [].concat(on[RANGE_TOKEN], on[event] || []);
    delete on[RANGE_TOKEN];
  }
  // This was originally intended to fix #4521 but no longer necessary
  // after 2.5. Keeping it for backwards compat with generated code from < 2.4
  /* istanbul ignore if */
  if (isDef(on[CHECKBOX_RADIO_TOKEN])) {
    on.change = [].concat(on[CHECKBOX_RADIO_TOKEN], on.change || []);
    delete on[CHECKBOX_RADIO_TOKEN];
  }
}

let target: any;

/**
 * 柯里化函数，返回一个直接调用函数的方法，调用完就删除事件
 * @param {*} event 转义过的事件
 * @param {*} handler 事件名
 * @param {*} capture 事件捕获或冒泡行为
 * @returns
 */
function createOnceHandler(event, handler, capture) {
  const _target = target; // save current target element in closure
  return function onceHandler() {
    const res = handler.apply(null, arguments);
    if (res !== null) {
      remove(
        event /**事件名 */,
        onceHandler /**绑定的事件 */,
        capture /**事件捕获或冒行为 */,
        _target /**真实DOM */
      );
    }
  };
}

// #9446: Firefox <= 53 (in particular, ESR 52) has incorrect Event.timeStamp
// implementation and does not fire microtasks in between event propagation, so
// safe to exclude.
const useMicrotaskFix = isUsingMicroTask && !(isFF && Number(isFF[1]) <= 53);

/**
 * 为
 * @param {*} name
 * @param {*} handler
 * @param {*} capture
 * @param {*} passive
 */
function add(
  name: string,
  handler: Function,
  capture: boolean,
  passive: boolean
) {
  // async edge case #6566: inner click event triggers patch, event handler
  // attached to outer element during patch, and triggered again. This
  // happens because browsers fire microtask ticks between event propagation.
  // the solution is simple: we save the timestamp when a handler is attached,
  // and the handler would only fire if the event passed to it was fired
  // AFTER it was attached.
  if (useMicrotaskFix) {
    const attachedTimestamp = currentFlushTimestamp;
    const original = handler;
    handler = original._wrapper = function (e) {
      if (
        // no bubbling, should always fire.
        // this is just a safety net in case event.timeStamp is unreliable in
        // certain weird environments...
        e.target === e.currentTarget ||
        // event is fired after handler attachment
        e.timeStamp >= attachedTimestamp ||
        // bail for environments that have buggy event.timeStamp implementations
        // #9462 iOS 9 bug: event.timeStamp is 0 after history.pushState
        // #9681 QtWebEngine event.timeStamp is negative value
        e.timeStamp <= 0 ||
        // #9448 bail if event is fired in another document in a multi-page
        // electron/nw.js app, since event.timeStamp will be using a different
        // starting reference
        e.target.ownerDocument !== document
      ) {
        return original.apply(this, arguments);
      }
    };
  }
  /**
   * 为真实DOM添加事件
   */
  target.addEventListener(
    name /**事件名称 */,
    handler /**转译过的事件, DOM 绑定的事件 */,
    supportsPassive ? { capture, passive } : capture /**事件是捕获还是冒泡 */
  );
}

/**
 * 删除真实DOM的事件
 * @param {*} name 事件名称
 * @param {*} handler 转译过的事件, DOM绑定的事件
 * @param {*} capture 事件捕获或者冒泡行为
 * @param {*} _target 真实DOM
 */
function remove(
  name: string,
  handler: Function,
  capture: boolean,
  _target?: HTMLElement
) {
  (_target || target).removeEventListener(
    name,
    handler._wrapper || handler,
    capture
  );
}

/**
 * 更新DOM事件
 * @param {*} oldVnode
 * @param {*} vnode
 * @returns
 */
function updateDOMListeners(oldVnode: VNodeWithData, vnode: VNodeWithData) {
  /**
   * 判断是否定义了事件on, 都没有定义直接结束
   */
  if (isUndef(oldVnode.data.on) && isUndef(vnode.data.on)) {
    return;
  }
  const on = vnode.data.on || {};
  const oldOn = oldVnode.data.on || {};

  /**获取真实DOM */
  target = vnode.elm;

  normalizeEvents(on);

  /**
   * 更新数据源并且为新的值添加函数， 旧值删除函数
   */
  updateListeners(
    on /**新的事件对象 */,
    oldOn /**旧的事件对象 */,
    add /**添加真实DOM的事件函数 */,
    remove /**删除真实DOM的事件函数 */,
    createOnceHandler,
    vnode.context /**vue实例化对象(new Vue) or 组件(构造函数实例化的对象) */
  );
  target = undefined;
}

export default {
  create: updateDOMListeners,
  update: updateDOMListeners,
};
