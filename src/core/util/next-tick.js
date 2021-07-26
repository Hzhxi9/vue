/* @flow */
/* globals MutationObserver */

import { noop } from "shared/util";
import { handleError } from "./error";
import { isIE, isIOS, isNative } from "./env";

export let isUsingMicroTask = false;

const callbacks = [];
let pending = false;
/**
 * 1. 将pending置为false，表示下一个flushCallbacks函数可以进入浏览器异步队列了
 * 2. 清空callbacks数组
 * 3. 执行callbacks数组中的每一个函数（比如flushSchedulerQueue、用户调用的nextTick传递的回调函数）
 */
function flushCallbacks() {
  pending = false;
  const copies = callbacks.slice(0);
  callbacks.length = 0;
  /**
   * 遍历callbacks数组，执行其中存储的每个flushSchedulerQueue函数
   */
  for (let i = 0; i < copies.length; i++) {
    copies[i]();
  }
}

// Here we have async deferring wrappers using microtasks.
// In 2.5 we used (macro) tasks (in combination with microtasks).
// However, it has subtle problems when state is changed right before repaint
// (e.g. #6813, out-in transitions).
// Also, using (macro) tasks in event handler would cause some weird behaviors
// that cannot be circumvented (e.g. #7109, #7153, #7546, #7834, #8109).
// So we now use microtasks everywhere, again.
// A major drawback of this tradeoff is that there are some scenarios
// where microtasks have too high a priority and fire in between supposedly
// sequential events (e.g. #4521, #6690, which have workarounds)
// or even between bubbling of the same event (#6566).
/**
 * 将flushCallbacks函数放入浏览器的异步任务队列中
 */
let timerFunc;

// The nextTick behavior leverages the microtask queue, which can be accessed
// via either native Promise.then or MutationObserver.
// MutationObserver has wider support, however it is seriously bugged in
// UIWebView in iOS >= 9.3.3 when triggered in touch event handlers. It
// completely stops working after triggering a few times... so, if native
// Promise is available, we will use it:
/* istanbul ignore next, $flow-disable-line */
if (typeof Promise !== "undefined" && isNative(Promise)) {
  /**
   * 首选Promise.resolve().then()
   */
  const p = Promise.resolve();
  timerFunc = () => {
    /**
     * 在微任务队列中放入flushCallbacks函数
     **/
    p.then(flushCallbacks);
    // In problematic UIWebViews, Promise.then doesn't completely break, but
    // it can get stuck in a weird state where callbacks are pushed into the
    // microtask queue but the queue isn't being flushed, until the browser
    // needs to do some other work, e.g. handle a timer. Therefore we can
    // "force" the microtask queue to be flushed by adding an empty timer.
    /**
     *  在有问题的UIWebView中，Promise.then不会完全中断，但是他可能会陷入怪异的状态
     *  在这种状态下，回调被推入微任务队列，但队列没有被刷新，直到浏览器需要执行其他工作，例如处理一个计数器
     *  因此我们可以通过添加空计时器来强制刷新微任务队列
     */

    if (isIOS) setTimeout(noop);
  };
  isUsingMicroTask = true;
} else if (
  !isIE &&
  typeof MutationObserver !== "undefined" &&
  (isNative(MutationObserver) ||
    // PhantomJS and iOS 7.x
    MutationObserver.toString() === "[object MutationObserverConstructor]")
) {
  // Use MutationObserver where native Promise is not available,
  // e.g. PhantomJS, iOS7, Android 4.4
  // (#6466 MutationObserver is unreliable in IE11)

  /**MutationObserver次之（微任务） */
  let counter = 1;
  const observer = new MutationObserver(flushCallbacks);
  const textNode = document.createTextNode(String(counter));
  observer.observe(textNode, {
    characterData: true,
  });
  timerFunc = () => {
    counter = (counter + 1) % 2;
    textNode.data = String(counter);
  };
  isUsingMicroTask = true;
} else if (typeof setImmediate !== "undefined" && isNative(setImmediate)) {
  // Fallback to setImmediate.
  // Technically it leverages the (macro) task queue,
  // but it is still a better choice than setTimeout.

  /**
   * setImmediate 已经是宏任务了，但仍然比setTimeout要好
   */
  timerFunc = () => {
    setImmediate(flushCallbacks);
  };
} else {
  // Fallback to setTimeout.
  /**最后没办法则使用setTimeout */
  timerFunc = () => {
    setTimeout(flushCallbacks, 0);
  };
}

/**
 * 完成两件事
 *  1. 用 try/catch 包装flushSchedulerQueue函数， 然后将其放入callbacks数组
 *  2. 如果pending 为false, 表示现在浏览器的任务队列中没有 flushCallbacks 函数
 *     如果pending 为true,则表示浏览器任务队列已经被放入了flushCallbacks函数
 *     待执行flushCallbacks函数时， pending会被再次置为false，表示下一个flushCallbacks函数可以进入下一个浏览器的任务队列了
 *
 * pending的作用： 保证在同一时刻，浏览器的任务队列中只有一个fullCallbacks的函数
 *
 * @param {*} cb 接收一个回调函数 => flushSchedulerQueue
 * @param {*} ctx 上下文
 * @returns
 */

export function nextTick(cb?: Function, ctx?: Object) {
  let _resolve;
  /**
   * 用callbacks数组存储经过包装的cb函数
   */
  callbacks.push(() => {
    if (cb) {
      /**用try/catch包装回调函数，便于错误捕获 */
      try {
        cb.call(ctx);
      } catch (e) {
        handleError(e, ctx, "nextTick");
      }
    } else if (_resolve) {
      _resolve(ctx);
    }
  });
  if (!pending) {
    pending = true;
    /**
     * 执行timerFunc
     * 在浏览器的任务队列中（首选微任务队列）放入flushCallbacks函数
     */
    timerFunc();
  }

  // $flow-disable-line
  if (!cb && typeof Promise !== "undefined") {
    return new Promise((resolve) => {
      _resolve = resolve;
    });
  }
}
