/* @flow */

import Dep from "./dep";
import VNode from "../vdom/vnode";
import { arrayMethods } from "./array";
import {
  def,
  warn,
  hasOwn,
  hasProto,
  isObject,
  isPlainObject,
  isPrimitive,
  isUndef,
  isValidArrayIndex,
  isServerRendering,
} from "../util/index";

const arrayKeys = Object.getOwnPropertyNames(arrayMethods);

/**
 * In some cases we may want to disable observation inside a component's
 * update computation.
 */
export let shouldObserve: boolean = true;

export function toggleObserving(value: boolean) {
  shouldObserve = value;
}

/**
 * Observer class that is attached to each observed
 * object. Once attached, the observer converts the target
 * object's property keys into getter/setters that
 * collect dependencies and dispatch updates.
 *
 * 观察者类， 会被附加到每个被观察的对象上，value.__ob__ = this
 * 而对象的各个属性则会被转换成getter/setter， 并收集依赖和通知更新
 *
 */
export class Observer {
  value: any;
  dep: Dep;
  vmCount: number; // number of vms that have this object as root $data

  constructor(value: any) {
    this.value = value;

    /**实例化一个dep */
    this.dep = new Dep();
    this.vmCount = 0;

    /**在value对象上设置__ob__属性 */
    def(value, "__ob__", this);

    /**处理数组响应式 */
    if (Array.isArray(value)) {
      /**
       * value 为数组
       * hasProto = '__proto__' in {}
       * 用于判断对象是否存在__proto__属性， 通过obj.__proto__可访问对象的原型链
       * 但由于__proto__不是标准属性， 所以有些浏览器不支持，比如IE6-10. Opera10.1
       * 为什么要判断，是因为一会儿要通过__proto__操作数据的原型链
       * 覆盖数组默认的七个原型方法，以实现数组响应式
       */
      if (hasProto) {
        /**有__proto__ */
        protoAugment(value, arrayMethods);
      } else {
        copyAugment(value, arrayMethods, arrayKeys);
      }
      this.observeArray(value);
    } else {
      /** 处理对象响应式 */
      /** value 为对象，为对象的每个属性(包括嵌套对象)设置响应式 */
      this.walk(value);
    }
  }

  /**
   * Walk through all properties and convert them into
   * getter/setters. This method should only be called when
   * value type is Object.
   *
   * 遍历对象上的每个key，为每个key设置响应式
   * 仅当值为对象时才会走这里
   */
  walk(obj: Object) {
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      defineReactive(obj, keys[i]);
    }
  }

  /**
   * Observe a list of Array items.
   * 遍历数组， 为数组的每一项设置观察，处理数组元素为对象的情况
   */
  observeArray(items: Array<any>) {
    for (let i = 0, l = items.length; i < l; i++) {
      observe(items[i]);
    }
  }
}

// helpers

/**
 * Augment a target Object or Array by intercepting
 * the prototype chain using __proto__
 */
function protoAugment(target, src: Object) {
  /**
   * 用经过增加的数组原型方法，覆盖默认的原型方法，
   * 之后在执行那七个数组方法时就具有了依赖通知更新的能力，已达到数组响应式更新的能力
   */
  /* eslint-disable no-proto */
  target.__proto__ = src;
  /* eslint-enable no-proto */
}

/**
 * Augment a target Object or Array by defining
 * hidden properties.
 *
 * 将增强的那七个方法直接赋值到数组对象上
 */
/* istanbul ignore next */
function copyAugment(target: Object, src: Object, keys: Array<string>) {
  for (let i = 0, l = keys.length; i < l; i++) {
    /**遍历数组每一个项，对其进行观察（响应式处理） */
    const key = keys[i];
    def(target, key, src[key]);
  }
}

/**
 * 响应式处理的真正入口
 * 为对象创建观察者实例，如果对象已经被观察过，则返回已有的观察者实例，否则创建新的观察者实例
 *
 * Attempt to create an observer instance for a value,
 * returns the new observer if successfully observed,
 * or the existing observer if the value already has one.
 */
export function observe(value: any, asRootData: ?boolean): Observer | void {
  /**非对象和VNode 实例不做响应式处理 */
  if (!isObject(value) || value instanceof VNode) {
    return;
  }
  let ob: Observer | void;
  if (hasOwn(value, "__ob__") && value.__ob__ instanceof Observer) {
    /**如果value对象上存在__ob__属性，则表示已经做过了观察了，直接返回__ob__属性 */
    ob = value.__ob__;
  } else if (
    shouldObserve &&
    !isServerRendering() &&
    (Array.isArray(value) || isPlainObject(value)) &&
    Object.isExtensible(value) &&
    !value._isVue
  ) {
    /**创建观察者实例，进行响应式处理  */
    ob = new Observer(value);
  }
  if (asRootData && ob) {
    ob.vmCount++;
  }
  return ob;
}

/**
 * Define a reactive property on an Object.
 *
 * 拦截obj[key]的读取和设置操作
 * 1. 在第一次读取时收集依赖，比如执行render函数生成虚拟DOM时会有读取操作
 * 2. 在更新时设置新值并通知依赖更新
 *
 */
export function defineReactive(
  obj: Object,
  key: string,
  val: any,
  customSetter?: ?Function,
  shallow?: boolean
) {
  /**
   * 实例化Dep，一个key对应一个dep
   */
  const dep = new Dep();

  /**
   * 获取getter和setter，获取val值
   */
  const property = Object.getOwnPropertyDescriptor(obj, key);
  if (property && property.configurable === false) {
    return;
  }

  // cater for pre-defined getter/setters

  const getter = property && property.get;
  const setter = property && property.set;
  if ((!getter || setter) && arguments.length === 2) {
    val = obj[key];
  }
  /**
   * 递归调用，处理val，即obj[key]的值为对象的情况，保证对象中的所有key都被观察
   */
  let childOb = !shallow && observe(val);
  /**
   * 响应式核心
   * 拦截对obj[key]的访问和设置
   **/
  Object.defineProperty(obj, key, {
    enumerable: true,
    configurable: true,
    /**get 拦截对obj[key]的读取操作， 进行依赖收集已经返回最新的值 */
    get: function reactiveGetter() {
      const value = getter ? getter.call(obj) : val;
      /**
       * Dep.target 为Dep类的一个静态属性，值为watcher，在实例化Watcher时会被设置
       * 实例化Watcher时会执行new Watcher时传递的回调函数(computed除外，因为它懒执行)
       * 而回调函数中如果有vm.key的读取行为，则会触发这里的读取拦截，进行依赖收集
       * 回调函数执行完以后有会将Dep.target设置为null，避免这里重复收集依赖
       */
      if (Dep.target) {
        /**依赖收集， 在dep中添加watcher，也在watcher中添加dep */
        dep.depend();
        /**childOb表示对象中嵌套对象的观察者对象，如果存在也对其进行依赖收集 */
        if (childOb) {
          /**这就是this.key.childKey被更新时能触发响应式更新的原因 */
          childOb.dep.depend();
          /**如果是obj[key]是数组，则触发数组响应式 */
          if (Array.isArray(value)) {
            /**为数组项为对象的项添加依赖 */
            dependArray(value);
          }
        }
      }
      return value;
    },
    /** 拦截obj.key = newVal的操作 */
    set: function reactiveSetter(newVal) {
      const value = getter ? getter.call(obj) : val;
      /* eslint-disable no-self-compare */
      if (newVal === value || (newVal !== newVal && value !== value)) {
        return;
      }
      /* eslint-enable no-self-compare */
      if (process.env.NODE_ENV !== "production" && customSetter) {
        customSetter();
      }
      // #7981: for accessor properties without setter
      if (getter && !setter) return;
      /**这是新值，用新值替换老值 */
      if (setter) {
        setter.call(obj, newVal);
      } else {
        val = newVal;
      }
      /**对新值进行响应式处理 */
      childOb = !shallow && observe(newVal);
      /**当响应式数据更新时，做派发更新 */
      dep.notify();
    },
  });
}

/**
 * Set a property on an object. Adds the new property and
 * triggers change notification if the property doesn't
 * already exist.
 */
export function set(target: Array<any> | Object, key: any, val: any): any {
  if (
    process.env.NODE_ENV !== "production" &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(
      `Cannot set reactive property on undefined, null, or primitive value: ${(target: any)}`
    );
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.length = Math.max(target.length, key);
    target.splice(key, 1, val);
    return val;
  }
  if (key in target && !(key in Object.prototype)) {
    target[key] = val;
    return val;
  }
  const ob = (target: any).__ob__;
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== "production" &&
      warn(
        "Avoid adding reactive properties to a Vue instance or its root $data " +
          "at runtime - declare it upfront in the data option."
      );
    return val;
  }
  if (!ob) {
    target[key] = val;
    return val;
  }
  defineReactive(ob.value, key, val);
  ob.dep.notify();
  return val;
}

/**
 * Delete a property and trigger change if necessary.
 */
export function del(target: Array<any> | Object, key: any) {
  if (
    process.env.NODE_ENV !== "production" &&
    (isUndef(target) || isPrimitive(target))
  ) {
    warn(
      `Cannot delete reactive property on undefined, null, or primitive value: ${(target: any)}`
    );
  }
  if (Array.isArray(target) && isValidArrayIndex(key)) {
    target.splice(key, 1);
    return;
  }
  const ob = (target: any).__ob__;
  if (target._isVue || (ob && ob.vmCount)) {
    process.env.NODE_ENV !== "production" &&
      warn(
        "Avoid deleting properties on a Vue instance or its root $data " +
          "- just set it to null."
      );
    return;
  }
  if (!hasOwn(target, key)) {
    return;
  }
  delete target[key];
  if (!ob) {
    return;
  }
  ob.dep.notify();
}

/**
 * Collect dependencies on array elements when the array is touched, since
 * we cannot intercept array element access like property getters.
 *
 * 处理数组选项为对象的情况，对其进行依赖的收集
 * 因为前面的所有处理都没办法对数组项为对象的元素进行依赖收集
 */
function dependArray(value: Array<any>) {
  for (let e, i = 0, l = value.length; i < l; i++) {
    e = value[i];
    e && e.__ob__ && e.__ob__.dep.depend();
    if (Array.isArray(e)) {
      dependArray(e);
    }
  }
}
