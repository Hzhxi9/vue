/* @flow */

import { warn } from "./debug";
import { observe, toggleObserving, shouldObserve } from "../observer/index";
import {
  hasOwn,
  isObject,
  toRawType,
  hyphenate,
  capitalize,
  isPlainObject,
} from "shared/util";

type PropOptions = {
  type: Function | Array<Function> | null,
  default: any,
  required: ?boolean,
  validator: ?Function,
};

/**
 * 检验props是否规范化数量并且为props添加value.__ob__属性
 * 把props添加到观察者中
 *
 * 校验props参数， 就是组建定义的props类型数据，校验数据
 * 判断props.type 的类型是不是Boolean或者String
 * 如果不是他们两类型，调用getProp DefaultValue获取默认值并且把value添加到观察者模式中
 * @param {*} key
 * @param {*} propOptions 原始props参数
 * @param {*} propsData 转义过的组件props数据
 * @param {*} vm  VueComponent组件构造函数
 * @returns
 */
export function validateProp(
  key: string,
  propOptions: Object,
  propsData: Object,
  vm?: Component
): any {
  /**
   * 获取组件定义的props属性
   */
  const prop = propOptions[key];

  /**如果该值为假，那么可能a-b这样的key才能获取到值 */
  const absent = !hasOwn(propsData, key);

  /**获取值 */
  let value = propsData[key];

  // boolean casting
  /**返回的是相同的索引，判断属性类型定义是否是Boolean */
  const booleanIndex = getTypeIndex(Boolean, prop.type);

  if (booleanIndex > -1) {
    /**如果是boolean值 */

    if (absent && !hasOwn(prop, "default")) {
      /**如果key不是propsData 实例化， 或者没有定义default 默认值的时候，设置value为false */
      value = false;
    } else if (value === "" || value === hyphenate(key)) {
      // only cast empty string / same name to boolean if
      // boolean has higher priority

      /**判断props.type的类型是不是String类型 */
      const stringIndex = getTypeIndex(String, prop.type);

      if (stringIndex < 0 || booleanIndex < stringIndex) {
        /**
         * 如果匹配不到字符串或者布尔值索引小于字符串索引的时候
         */
        value = true;
      }
    }
  }
  // check default value 检查默认值
  if (value === undefined) {
    /**没有value，也不是boolean， 也不是string */

    /**有可能是函数 */
    value = getPropDefaultValue(vm, prop, key);
    // since the default value is a fresh copy,
    // make sure to observe it.
    const prevShouldObserve = shouldObserve;
    toggleObserving(true);

    /**为value添加value.__ob__shu */
    observe(value);
    toggleObserving(prevShouldObserve);
  }
  if (
    process.env.NODE_ENV !== "production" &&
    // skip validation for weex recycle-list child component props
    !(__WEEX__ && isObject(value) && "@binding" in value)
  ) {
    /**检查props是否合格 */
    assertProp(prop, key, value, vm, absent);
  }
  return value;
}

/**
 * 获取props属性的默认值
 * Get the default value of a prop.
 */
function getPropDefaultValue(
  vm: ?Component,
  prop: PropOptions,
  key: string
): any {
  // no default, return undefined
  /**判断该对象prop 中的default 是否是prop 实例化的 */
  if (!hasOwn(prop, "default")) {
    return undefined;
  }
  const def = prop.default;
  // warn against non-factory defaults for Object & Array
  /**警告对象和数组的非工厂默认值 */
  if (process.env.NODE_ENV !== "production" && isObject(def)) {
    warn(
      'Invalid default value for prop "' +
        key +
        '": ' +
        "Props with type Object/Array must use a factory function " +
        "to return the default value.",
      vm
    );
  }
  // the raw prop value was also undefined from previous render,
  // return previous default value to avoid unnecessary watcher trigger
  if (
    vm &&
    vm.$options.propsData &&
    vm.$options.propsData[key] === undefined &&
    vm._props[key] !== undefined
  ) {
    return vm._props[key];
  }
  // call factory function for non-Function types
  // a value is Function if its prototype is function even across different execution context
  return typeof def === "function" && getType(prop.type) !== "Function"
    ? def.call(vm)
    : def;
}

/**
 * Assert whether a prop is valid.
 * 断言一个属性是否有效。
 * @param {*} prop 属性的type属性
 * @param {*} name props属性中的key值
 * @param {*} value view属性的值
 * @param {*} vm 组件构造函数
 * @param {*} absent false
 * @returns
 */
function assertProp(
  prop: PropOptions,
  name: string,
  value: any,
  vm: ?Component,
  absent: boolean
) {
  /**必须有required 和absent */
  if (prop.required && absent) {
    warn('Missing required prop: "' + name + '"', vm);
    return;
  }

  /**如果value为空或者不是必选项，则不执行下面代码 */
  if (value == null && !prop.required) {
    return;
  }

  /**类型 */
  let type = prop.type;

  /**如果类型为真 或者 类型不存在 */
  let valid = !type || type === true;

  const expectedTypes = [];

  if (type) {
    /**如果type存在 */
    if (!Array.isArray(type)) {
      /**不是数组， 包裹成数组 */
      type = [type];
    }

    for (let i = 0; i < type.length && !valid; i++) {
      const assertedType = assertType(value, type[i], vm);
      expectedTypes.push(assertedType.expectedType || "");
      valid = assertedType.valid;
    }
  }

  const haveExpectedTypes = expectedTypes.some((t) => t);
  if (!valid && haveExpectedTypes) {
    warn(getInvalidTypeMessage(name, value, expectedTypes), vm);
    return;
  }
  const validator = prop.validator;
  if (validator) {
    if (!validator(value)) {
      warn(
        'Invalid prop: custom validator check failed for prop "' + name + '".',
        vm
      );
    }
  }
}

/**检测数据类型 是否是String|Number|Boolean|Function|Symbol 其中的一个数据类型 */
const simpleCheckRE = /^(String|Number|Boolean|Function|Symbol|BigInt)$/;

/**
 * 获取type类型
 * @param {*} value
 * @param {*} type
 * @param {*} vm
 * @returns
 */
function assertType(
  value: any,
  type: Function,
  vm: ?Component
): {
  valid: boolean,
  expectedType: string,
} {
  let valid;

  /**
   * 检查函数是否函数声明，如果是函数表达式或者匿名表达式是匹配不上的
   * type 必须是 String|Number|Boolean|Function|Symbol 构造函数
   **/
  const expectedType = getType(type);

  /**检查函数是什么类型 */
  if (simpleCheckRE.test(expectedType)) {
    /**
     * type 必须是String|Number|Boolean|Function|Symbol 构造函数
     * 这里才为真 (String|Number|Boolean|Function|Symbol)
     */
    const t = typeof value;

    /**转换成小写 */
    valid = t === expectedType.toLowerCase();

    /**
     * 对于原始值进行包装
     * for primitive wrapper objects
     */
    if (!valid && t === "object") {
      valid = value instanceof type;
    }
  } else if (expectedType === "Object") {
    /**
     * 检查是否真正的对象
     */
    valid = isPlainObject(value);
  } else if (expectedType === "Array") {
    valid = Array.isArray(value);
    /**
     * 检查是否是真正的数组
     */
  } else {
    try {
      /**判断value是否是type中的实例对象 */
      valid = value instanceof type;
    } catch (e) {
      warn(
        'Invalid prop type: "' + String(type) + '" is not a constructor',
        vm
      );
      valid = false;
    }
  }

  return {
    valid,
    expectedType,
  };
}

const functionTypeCheckRE = /^\s*function (\w+)/;

/**
 * Use function string name to check built-in types,
 * because a simple equality check will fail when running
 * across different vms / iframes.
 * 检查函数是否是函数声明  如果是函数表达式或者匿名函数是匹配不上的
 */
function getType(fn) {
  const match = fn && fn.toString().match(functionTypeCheckRE);
  return match ? match[1] : "";
}

/**
 * 判断两个函数声明是否是相等
 * @param {*} a 
 * @param {*} b 
 * @returns 
 */
function isSameType(a, b) {
  return getType(a) === getType(b);
}

/**
 * 判断expectedTypes 中的函数和 type 函数是否有相等的如有有则返回索引index 如果没有则返回-1
 * @param {*} type 
 * @param {*} expectedTypes 
 * @returns 
 */
function getTypeIndex(type, expectedTypes): number {
  if (!Array.isArray(expectedTypes)) {
    /**不是数组直接返回0 */
    return isSameType(expectedTypes, type) ? 0 : -1;
  }

  for (let i = 0, len = expectedTypes.length; i < len; i++) {
    /**是数组则循环查找索引 */
    if (isSameType(expectedTypes[i], type)) {
      return i;
    }
  }
  return -1;
}

function getInvalidTypeMessage(name, value, expectedTypes) {
  let message =
    `Invalid prop: type check failed for prop "${name}".` +
    ` Expected ${expectedTypes.map(capitalize).join(", ")}`;
  const expectedType = expectedTypes[0];
  const receivedType = toRawType(value);
  // check if we need to specify expected value
  if (
    expectedTypes.length === 1 &&
    isExplicable(expectedType) &&
    isExplicable(typeof value) &&
    !isBoolean(expectedType, receivedType)
  ) {
    message += ` with value ${styleValue(value, expectedType)}`;
  }
  message += `, got ${receivedType} `;
  // check if we need to specify received value
  if (isExplicable(receivedType)) {
    message += `with value ${styleValue(value, receivedType)}.`;
  }
  return message;
}

function styleValue(value, type) {
  if (type === "String") {
    return `"${value}"`;
  } else if (type === "Number") {
    return `${Number(value)}`;
  } else {
    return `${value}`;
  }
}

const EXPLICABLE_TYPES = ["string", "number", "boolean"];
function isExplicable(value) {
  return EXPLICABLE_TYPES.some((elem) => value.toLowerCase() === elem);
}

function isBoolean(...args) {
  return args.some((elem) => elem.toLowerCase() === "boolean");
}
