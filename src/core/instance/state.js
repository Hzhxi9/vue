/* @flow */

import config from "../config";
import Watcher from "../observer/watcher";
import Dep, { pushTarget, popTarget } from "../observer/dep";
import { isUpdatingChildComponent } from "./lifecycle";

import {
  set,
  del,
  observe,
  defineReactive,
  toggleObserving,
} from "../observer/index";

import {
  warn,
  bind,
  noop,
  hasOwn,
  hyphenate,
  isReserved,
  handleError,
  nativeWatch,
  validateProp,
  isPlainObject,
  isServerRendering,
  isReservedAttribute,
  invokeWithErrorHandling,
} from "../util/index";

const sharedPropertyDefinition = {
  enumerable: true,
  configurable: true,
  get: noop,
  set: noop,
};

/**设置代理， 将key代理到vue实例上 */
export function proxy(target: Object, sourceKey: string, key: string) {
  sharedPropertyDefinition.get = function proxyGetter() {
    /** this._props.key */
    return this[sourceKey][key];
  };
  sharedPropertyDefinition.set = function proxySetter(val) {
    this[sourceKey][key] = val;
  };
  /**拦截对this.key的访问 */
  Object.defineProperty(target, key, sharedPropertyDefinition);
}

/**
 * 数据响应式的入口：分别处理props，methods， data， computed，watch
 * 优先级：props，methods，data，computed，对象中的属性不能出现重复，优先级和列出顺序一致
 *       其中computed中的key不能和props，data中的key重复，methods不影响
 * @param {*} vm
 */
export function initState(vm: Component) {
  vm._watchers = [];
  const opts = vm.$options;

  /**处理props，为props对象的每个属性设置了响应式，并将其代理到vm实例上，支持this.propKey的方式访问 */
  if (opts.props) initProps(vm, opts.props);

  /**处理methods对象， 校验每个属性的值是否为函数，和props属性比对进行判重处理，最后得到vm[key]=methods[key]  */
  if (opts.methods) initMethods(vm, opts.methods);

  /**
   * 做了三件事
   * 1. 判重处理，data对象上的属性不能和props，methods对象上的属性相同
   * 2. 代理data对象上的属性到vm实例
   * 3. 为data对象上的数据设置了响应式
   */
  if (opts.data) {
    initData(vm);
  } else {
    observe((vm._data = {}), true /* asRootData */);
  }

  /**
   * 三件事
   * 1. 为computed[key]创建watcher实例，默认是懒执行
   * 2. 代理computed[key]到vm实例
   * 3. 判重，computed中的key不能和data，props中的属性重复
   */
  if (opts.computed) initComputed(vm, opts.computed);

  /**
   * 1. 处理watch对象
   * 2. 为每个watch.key创建watcher实例，key和watcher实例可能是一对多的关系
   * 3. 如果设置了immediate，则立即执行回调函数
   * 4 .返回一个unwatch
   */
  if (opts.watch && opts.watch !== nativeWatch) {
    initWatch(vm, opts.watch);
  }

  /**
   * 其实到这里能看出，computed和watch在本质是没有区别的，都是通过watcher去实现的响应式
   * 非要说有区别，那也是在使用方式上的区别， 简单来说
   * 1. watch： 适用于数据变化时执行异步或者开销较大的操作时使用， 即需要长时间等待的操作可以放在watch中
   * 2. computed: 其中可以使用异步方法，但是没有任何意义，所以computed更适合做一些同步计算
   *
   * computed默认懒执行，且不可更改，但是watcher可配置
   * 使用场景不同
   */
}

/**
 * 处理props对象，为props对象的每个属性设置响应式，并将其代理到vm实例上
 * @param {*} vm
 * @param {*} propsOptions
 */
function initProps(vm: Component, propsOptions: Object) {
  const propsData = vm.$options.propsData || {};
  const props = (vm._props = {});
  // cache prop keys so that future props updates can iterate using Array
  // instead of dynamic object key enumeration.

  /**缓存props的每个key，性能优化 */
  const keys = (vm.$options._propKeys = []);
  const isRoot = !vm.$parent;

  // root instance props should be converted
  if (!isRoot) toggleObserving(false);

  /**遍历props对象 */
  for (const key in propsOptions) {
    /**缓存key */
    keys.push(key);

    /**获取props[key]的默认值 */
    const value = validateProp(key, propsOptions, propsData, vm);

    /* istanbul ignore else */
    if (process.env.NODE_ENV !== "production") {
      const hyphenatedKey = hyphenate(key);
      if (
        isReservedAttribute(hyphenatedKey) ||
        config.isReservedAttr(hyphenatedKey)
      ) {
        warn(
          `"${hyphenatedKey}" is a reserved attribute and cannot be used as component prop.`,
          vm
        );
      }

      defineReactive(props, key, value, () => {
        if (!isRoot && !isUpdatingChildComponent) {
          warn(
            `Avoid mutating a prop directly since the value will be ` +
              `overwritten whenever the parent component re-renders. ` +
              `Instead, use a data or computed property based on the prop's ` +
              `value. Prop being mutated: "${key}"`,
            vm
          );
        }
      });
    } else {
      /**为props的每个key是设置数据响应式 */
      defineReactive(props, key, value);
    }
    // static props are already proxied on the component's prototype
    // during Vue.extend(). We only need to proxy props defined at
    // instantiation here.
    if (!(key in vm)) {
      /**
       * 代理到key到vm对象上
       * 用this.propsKey
       * */
      proxy(vm, `_props`, key);
    }
  }
  toggleObserving(true);
}

/**
 * 三件事
 * 1. 判重处理，data对象上的属性不能和props，methods对象上的属性相同
 * 2. 代理data对象上的属性到vm实例
 * 3。 为data对象上的数据设置了响应式
 * @param {*} vm
 */
function initData(vm: Component) {
  /**
   * 得到data对象
   */
  let data = vm.$options.data;
  /**
   * 保证后续处理的data是一个对象
   */
  data = vm._data = typeof data === "function" ? getData(data, vm) : data || {};

  if (!isPlainObject(data)) {
    data = {};
    process.env.NODE_ENV !== "production" &&
      warn(
        "data functions should return an object:\n" +
          "https://vuejs.org/v2/guide/components.html#data-Must-Be-a-Function",
        vm
      );
  }
  // proxy data on instance

  /**
   * 两件事
   * 1. 判重处理，data对象上的属性不能和props，methods对象上有属性相同
   * 2. 代理data对象上的属性到vm实例
   */
  const keys = Object.keys(data);
  const props = vm.$options.props;
  const methods = vm.$options.methods;
  let i = keys.length;
  while (i--) {
    const key = keys[i];
    if (process.env.NODE_ENV !== "production") {
      if (methods && hasOwn(methods, key)) {
        warn(
          `Method "${key}" has already been defined as a data property.`,
          vm
        );
      }
    }
    if (props && hasOwn(props, key)) {
      process.env.NODE_ENV !== "production" &&
        warn(
          `The data property "${key}" is already declared as a prop. ` +
            `Use prop default value instead.`,
          vm
        );
    } else if (!isReserved(key)) {
      /**
       * 代理data中的属性到vue实例上
       * 支持通过this.key的方式访问
       */
      proxy(vm, `_data`, key);
    }
  }

  /**
   * observe data
   * 为data对象上的数据设置响应式
   **/
  observe(data, true /* asRootData */);
}

export function getData(data: Function, vm: Component): any {
  // #7573 disable dep collection when invoking data getters
  pushTarget();
  try {
    return data.call(vm, vm);
  } catch (e) {
    handleError(e, vm, `data()`);
    return {};
  } finally {
    popTarget();
  }
}

const computedWatcherOptions = { lazy: true };

/**
 * 三件事
 * 1. 为computed[key]创建watcher实例， 默认是懒执行
 * 2. 代理computed[key]到vm实例
 * 3. 判重，computed中的key不能和data，props中的属性重复
 *
 * @param {*} vm
 * @param {*} computed
 */
function initComputed(vm: Component, computed: Object) {
  // $flow-disable-line
  const watchers = (vm._computedWatchers = Object.create(null));

  // computed properties are just getters during SSR
  const isSSR = isServerRendering();

  /**遍历computed对象 */
  for (const key in computed) {
    /**获取key对应的值， 即getter函数 */

    const userDef = computed[key];

    // 函数
    // {
    //   computed: {
    //     message: function () {},
    //   }
    // };

    // 对象
    // {
    //   computed: {
    //     message: {
    //       get() {},
    //       set() {},
    //     },
    //   },
    // };

    const getter = typeof userDef === "function" ? userDef : userDef.get;
    if (process.env.NODE_ENV !== "production" && getter == null) {
      warn(`Getter is missing for computed property "${key}".`, vm);
    }

    if (!isSSR) {
      // create internal watcher for the computed property.
      /**
       * 为computed属性创建watcher实例
       * 所以computed就是通过watcher来实现的
       **/
      watchers[key] = new Watcher(
        vm,
        getter || noop,
        noop,
        /**配置项， computed默认是懒执行 */
        computedWatcherOptions
      );
    }

    // component-defined computed properties are already defined on the
    // component prototype. We only need to define computed properties defined
    // at instantiation here.

    if (!(key in vm)) {
      /**
       * 代理computed对象中的属性到vm实例
       * 这样就可以使用vm.computedKey 访问计算属性了
       */
      defineComputed(vm, key, userDef);
    } else if (process.env.NODE_ENV !== "production") {
      /**
       * 非生产环境有一个判重处理，computed对象中的属性不能data，props中的属性相同
       */
      if (key in vm.$data) {
        warn(`The computed property "${key}" is already defined in data.`, vm);
      } else if (vm.$options.props && key in vm.$options.props) {
        warn(
          `The computed property "${key}" is already defined as a prop.`,
          vm
        );
      } else if (vm.$options.methods && key in vm.$options.methods) {
        warn(
          `The computed property "${key}" is already defined as a method.`,
          vm
        );
      }
    }
  }
}

/**
 * 代理computed对象中的key到target（vm）上
 * @param {*} target
 * @param {*} key
 * @param {*} userDef
 */
export function defineComputed(
  target: any,
  key: string,
  userDef: Object | Function
) {
  const shouldCache = !isServerRendering();
  /**
   * 构造属性描述符(get,set)
   */
  if (typeof userDef === "function") {
    sharedPropertyDefinition.get = shouldCache
      ? createComputedGetter(key)
      : createGetterInvoker(userDef);
    sharedPropertyDefinition.set = noop;
  } else {
    sharedPropertyDefinition.get = userDef.get
      ? shouldCache && userDef.cache !== false
        ? createComputedGetter(key)
        : createGetterInvoker(userDef.get)
      : noop;
    sharedPropertyDefinition.set = userDef.set || noop;
  }
  if (
    process.env.NODE_ENV !== "production" &&
    sharedPropertyDefinition.set === noop
  ) {
    sharedPropertyDefinition.set = function () {
      warn(
        `Computed property "${key}" was assigned to but it has no setter.`,
        this
      );
    };
  }
  /**
   * 拦截对target.key的访问和设置
   * 将computed配置项中的key代理到vue实例上
   * 支持通过this.computedKey的方式去访问Computed中的属性
   **/
  Object.defineProperty(target, key, sharedPropertyDefinition);
}

/**
 * 返回一个函数，这个函数在访问vm.computedProperty时会被执行，然后返回执行结果
 * @param {*} key
 * @returns
 */
function createComputedGetter(key) {
  /**
   * computed属性会缓存的原理也是在这里结合watcher.dirty,watcher.evalaute,watcher.update实现的
   */
  return function computedGetter() {
    /**
     * 得到当前key对应的watcher
     */
    const watcher = this._computedWatchers && this._computedWatchers[key];

    console.log(watcher, "=watcher.dirty");
    if (watcher) {
      /**
       * 计算 key 对应的值，通过执行computed.key的回调函数来得到
       * watcher.dirty属性就是大家常说的computed计算结果会缓存的原理
       * <template>
       *    <div>{{ computedProperty }}</div>
       * </template>
       *
       *
       * 像这种情况下，在页面的一次渲染中， 两个dom中的computedProperty只要第一个
       * 会执行computed。computedProperty的回调函数计算实际的值
       * 即执行watcher.evalaute, 而第二次就不走计算过程
       * 因为上一次执行watcher.update方法会讲watcher.dirty重新置为false
       * 待页面更新后，watcher.update方法会将watcher.dirty重新置为true
       * 供下次页面更新时重新计算computed.key的结果
       *
       * 执行watcher.evaluate方法
       * 执行computed.key的值（函数）得到函数的执行结果，赋值给watcher.value
       * 将watcher.dirty 赋值为false
       *
       * computed的缓存实现原理
       *
       */
      if (watcher.dirty) {
        console.log("初始化执行吗");
        watcher.evaluate();
      }
      if (Dep.target) {
        watcher.depend();
      }
      return watcher.value;
    }
  };
}

/**功能同createComputedGetter一样 */
function createGetterInvoker(fn) {
  return function computedGetter() {
    return fn.call(this, this);
  };
}
/**
 * 三件事
 * 1. 校验methods[key]，必须是一个函数
 * 2. 判重
 *      methods中的key不能和props中的key相同
 *      methods中的key与Vue实例上已有的方法重叠，一般是一些内置方法，比如以$和_开头的方法
 * 3. 将methods[key]放到vm实例上，得到vm[key]=methods[key]
 * @param {*} vm
 * @param {*} methods
 */
function initMethods(vm: Component, methods: Object) {
  /**获取props配置项 */
  const props = vm.$options.props;

  /**
   * 判重
   * 遍历methods对象，methods 中的key不能和props中key重复
   **/
  for (const key in methods) {
    if (process.env.NODE_ENV !== "production") {
      if (typeof methods[key] !== "function") {
        warn(
          `Method "${key}" has type "${typeof methods[
            key
          ]}" in the component definition. ` +
            `Did you reference the function correctly?`,
          vm
        );
      }
      if (props && hasOwn(props, key)) {
        warn(`Method "${key}" has already been defined as a prop.`, vm);
      }
      if (key in vm && isReserved(key)) {
        warn(
          `Method "${key}" conflicts with an existing Vue instance method. ` +
            `Avoid defining component methods that start with _ or $.`
        );
      }
    }

    /**
     * 将methods中的所有方法赋值到vue实例上
     * 支持通过this.methodKey的方式访问定义的方法
     */
    vm[key] =
      typeof methods[key] !== "function" ? noop : bind(methods[key], vm);
  }
}

/**
 * 处理watch对象的入口
 *  1. 遍历watch对象
 *  2. 调用createWatcher函数
 *  watch =  {
 *    'key1': function(val, oldVal){},
 *    'key2': 'this.methodName',
 *    'key3': {
 *        handler: function(val, oldVal){},
 *        deep: true
 *    },
 *    'key4': [
 *      'this.methodName',
 *      function handle1(){},
 *      {
 *        handle: function(){},
 *        immediate: true
 *      }
 *    ],
 *    'key.key5'{}
 *  }
 * @param {*} vm
 * @param {*} watch
 */
function initWatch(vm: Component, watch: Object) {
  /**
   * 遍历watch对象
   */
  for (const key in watch) {
    const handler = watch[key];
    /**
     * handle 为数组， 遍历数组，获取其中的每一项，然后调用createWatcher
     */
    if (Array.isArray(handler)) {
      for (let i = 0; i < handler.length; i++) {
        createWatcher(vm, key, handler[i]);
      }
    } else {
      createWatcher(vm, key, handler);
    }
  }
}

/**
 * 1. 兼容性处理，保证handle肯定是一个函数
 * 2. 调用$watch
 *
 * @param {*} vm
 * @param {*} expOrFn
 * @param {*} handler
 * @param {*} options
 * @returns
 */
function createWatcher(
  vm: Component,
  expOrFn: string | Function,
  handler: any,
  options?: Object
) {
  /**
   * 如果handle为对象， 则获取其中的handle选项的函数
   */
  if (isPlainObject(handler)) {
    options = handler;
    handler = handler.handler;
  }
  /**
   * 如果handle为字符串， 则说明是一个methods方法， 直接通过this.methodsKey的方式拿到这个函数
   */
  if (typeof handler === "string") {
    handler = vm[handler];
  }
  return vm.$watch(expOrFn, handler, options);
}

export function stateMixin(Vue: Class<Component>) {
  // flow somehow has problems with directly declared definition object
  // when using Object.defineProperty, so we have to procedurally build up
  // the object here.
  const dataDef = {};
  dataDef.get = function () {
    return this._data;
  };
  const propsDef = {};
  propsDef.get = function () {
    return this._props;
  };
  if (process.env.NODE_ENV !== "production") {
    dataDef.set = function () {
      warn(
        "Avoid replacing instance root $data. " +
          "Use nested data properties instead.",
        this
      );
    };
    propsDef.set = function () {
      warn(`$props is readonly.`, this);
    };
  }
  Object.defineProperty(Vue.prototype, "$data", dataDef);
  Object.defineProperty(Vue.prototype, "$props", propsDef);

  Vue.prototype.$set = set;
  Vue.prototype.$delete = del;

  /**
   * 创建watcher， 返回unwatch， 共完成了五件事
   * 1. 兼容性处理， 保证最后new Watcher时的cb为函数
   * 2. 标示用户watcher
   * 3. 创建watcher实例
   * 4. 如果设置了immediate，则立即执行了一次cb
   * 5. 返回了unwatch
   * @param {*} expOrFn
   * @param {*} cb
   * @param {*} options
   * @returns
   */

  Vue.prototype.$watch = function (
    expOrFn: string | Function,
    cb: any,
    options?: Object
  ): Function {
    const vm: Component = this;
    /**
     * 兼容性处理
     * 因为用户调用vm.$watch时设置的cb可能是对象
     * 保证后续的cb肯定是一个函数
     */
    if (isPlainObject(cb)) {
      return createWatcher(vm, expOrFn, cb, options);
    }
    /**
     * option.user 表示用户watcher， 还有渲染watcher，即updateComponent方法中实例化的watcher
     */
    options = options || {};
    options.user = true;
    /**
     * 创建watcher
     */
    const watcher = new Watcher(vm, expOrFn, cb, options);
    /**
     * 如果用户设置了immediate为true， 则立即执行一次回调函数
     */
    if (options.immediate) {
      const info = `callback for immediate watcher "${watcher.expression}"`;
      pushTarget();
      invokeWithErrorHandling(cb, vm, [watcher.value], vm, info);
      popTarget();
    }
    /**返回一个unwatch函数， 用于解除监听 */
    return function unwatchFn() {
      watcher.teardown();
    };
  };
}
