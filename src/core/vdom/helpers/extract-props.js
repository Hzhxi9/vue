/* @flow */

import {
  tip,
  hasOwn,
  isDef,
  isUndef,
  hyphenate,
  formatComponentName,
} from "core/util/index";

/**
 * <comp :msg="hello vue"></comp>
 * 
 * 提取props，得到res[key] = val
 * 
 * 以props配置中的属性为key,父组件中对应的数据为value
 * 当父组件中数据更新时，触发响应式更新，重新执行render，生成新的VNode，又走到这里
 * 这样子组件中相应的数据就会被更新
 * @param {*} data 组件上的属性 { msg: 'hello vue' }
 * @param {*} Ctor 组件构造函数
 * @param {*} tag 组件标签
 * @returns
 */
export function extractPropsFromVNodeData(
  data: VNodeData,
  Ctor: Class<Component>,
  tag?: string
): ?Object {
  // we are only extracting raw values here.
  // validation and default values are handled in the child
  // component itself.
  /**
   * 组件的props选项，{ props: { msg: { type: String, default: xx } } }
   * 这里只提取原始值， 验证和默认值在子组件中处理
   */
  const propOptions = Ctor.options.props;
  if (isUndef(propOptions)) {
    /**
     * 未定义props直接返回
     */
    return;
  }

  /**
   * 以组件props配置中的属性为key， 父组件传递下来的值为value
   * 当父组件中数据更新时， 触发响应式更新，重新执行render，生成新的VNode，又走到这里
   * 这样子组件中相应的数据就会被更新
   */
  const res = {};
  const { attrs, props } = data;
  if (isDef(attrs) || isDef(props)) {
    /**遍历propsOptions */
    for (const key in propOptions) {
      /**将小驼峰形式的key转换为连字符形式 */
      const altKey = hyphenate(key);
      if (process.env.NODE_ENV !== "production") {
        const keyInLowerCase = key.toLowerCase();
        if (key !== keyInLowerCase && attrs && hasOwn(attrs, keyInLowerCase)) {
          /**
           * 提示，如果声明的props为小驼峰形式(testProps),
           * 但由于html不区分大小写，所以在html模板中应该使用test-props代替testProps
           */
          tip(
            `Prop "${keyInLowerCase}" is passed to component ` +
              `${formatComponentName(
                tag || Ctor
              )}, but the declared prop name is` +
              ` "${key}". ` +
              `Note that HTML attributes are case-insensitive and camelCased ` +
              `props need to use their kebab-case equivalents when using in-DOM ` +
              `templates. You should probably use "${altKey}" instead of "${key}".`
          );
        }
      }
      checkProp(res, props, key, altKey, true) ||
        checkProp(res, attrs, key, altKey, false);
    }
  }
  return res;
}

/**
 * 得到res[key] = val
 * @param {*} res 
 * @param {*} hash 
 * @param {*} key 
 * @param {*} altKey 
 * @param {*} preserve 
 * @returns 
 */
function checkProp(
  res: Object,
  hash: ?Object,
  key: string,
  altKey: string,
  preserve: boolean
): boolean {
  if (isDef(hash)) {
    /**
     * 判断hash(props/attrs)对象中是否存在key或altKey
     * 存在则设置给res => res[key] = hash[key]
     */
    if (hasOwn(hash, key)) {
      res[key] = hash[key];
      if (!preserve) {
        delete hash[key];
      }
      return true;
    } else if (hasOwn(hash, altKey)) {
      res[key] = hash[altKey];
      if (!preserve) {
        delete hash[altKey];
      }
      return true;
    }
  }
  return false;
}
