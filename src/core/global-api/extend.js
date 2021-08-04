/* @flow */

import { ASSET_TYPES } from "shared/constants";
import { defineComputed, proxy } from "../instance/state";
import { extend, mergeOptions, validateComponentName } from "../util/index";

/**
 * 定义 Vue.extend方法
 * 基于Vue去扩展子类， 给子类同样支持进一步的扩展
 * 扩展时可以传递一些默认配置，就像Vue也会有一些默认配置
 * 默认配置如果和基类有冲突则会进行选项合并
 *
 * 使用基础 Vue 构造器，创建一个“子类”。参数是一个包含组件选项的对象。
 * @param {*} Vue
 */
export function initExtend(Vue: GlobalAPI) {
  /**
   * Each instance constructor, including Vue, has a unique
   * cid. This enables us to create wrapped "child
   * constructors" for prototypal inheritance and cache them.
   */
  Vue.cid = 0;
  let cid = 1;

  /**
   * Class inheritance
   * 扩展Vue子类， 预设一些配置项
   */
  Vue.extend = function (extendOptions: Object): Function {
    extendOptions = extendOptions || {};
    const Super = this;
    const SuperId = Super.cid;
    /**
     * 通过同一个配置项多次调用Vue.extend方法时， 第二次调用开始就会使用缓存
     *
     * 利用缓存，如果存在则直接返回缓存中的构造函数
     * 如果在多次调用Vue.extend 是使用了同一个配置项(extendOptions), 这时候就会启用该缓存
     */
    const cachedCtors = extendOptions._Ctor || (extendOptions._Ctor = {});
    if (cachedCtors[SuperId]) {
      return cachedCtors[SuperId];
    }

    /**验证组件name */
    const name = extendOptions.name || Super.options.name;
    if (process.env.NODE_ENV !== "production" && name) {
      validateComponentName(name);
    }

    /**重点，定义Vue子类， 和Vue构造函数一样 */
    const Sub = function VueComponent(options) {
      /**初始化 */
      this._init(options);
    };
    /**
     * 设置子类的原型对象
     * 通过原型继承的方式继承Vue
     */
    Sub.prototype = Object.create(Super.prototype);
    /**设置构造函数 */
    Sub.prototype.constructor = Sub;
    Sub.cid = cid++;
    /**
     * 选项合并， 合并Vue的配置项到自己的配置项上来
     * 
     * 合并基类的选项和传递进来的选项
     * 可以通过Vue.extend 方法定义一个子类，预设一些配置项
     * 这些配置项就相当于我们直接使用Vue构造函数时的默认配置一样
     */
    Sub.options = mergeOptions(Super.options, extendOptions);

    /**记录自己的基类 */
    Sub["super"] = Super;

    // For props and computed properties, we define the proxy getters on
    // the Vue instances at extension time, on the extended prototype. This
    // avoids Object.defineProperty calls for each instance created.
    /**
     * 
     * 将props 和 computed 代理到子类上， 在子类上支持通过this.xx 方式访问
     * 
     * 初始化props，将props配置代理到Sub.prototype_props对象上
     * 在组件内通过 this_props方式可以访问
     **/
    if (Sub.options.props) {
      initProps(Sub);
    }
    /**
     * 初始化computed， 将computed 配置代理到Sub.prototype对象上
     * 在组件内可以通过this.computedKey 的方式访问
     */
    if (Sub.options.computed) {
      initComputed(Sub);
    }

    // allow further extension/mixin/plugin usage
    /** 
     * 让子类支持继续向下扩展 
     * 定义extend、 mixin、 use这三个静态方法， 允许在Sub基础上再进一步构造子类
     **/
    Sub.extend = Super.extend;
    Sub.mixin = Super.mixin;
    Sub.use = Super.use;

    // create asset registers, so extended classes
    // can have their private assets too.
    /**
     * 给子类设置全局配置对象，定义三个静态方法
     * component、 directive、 filter
     **/
    ASSET_TYPES.forEach(function (type) {
      Sub[type] = Super[type];
    });

    // enable recursive self-lookup
    /**
     * 组件递归自调用的实现原理
     * 
     * 递归组件的原理， 如果组件设置了name属性， 则将自己注册到自己的components 选项中
     */
    if (name) {
      /**
       * {
       *   name: 'Comp'
       *   components: { 'Comp': Comp }
       * }
       */
      Sub.options.components[name] = Sub;
    }

    // keep a reference to the super options at extension time.
    // later at instantiation we can check if Super's options have
    // been updated.
    /**
     * 在扩展是保留对基类选项的引用
     * 稍后在实例时， 可以检查Super的选项是否具有更新
     */
    Sub.superOptions = Super.options;
    Sub.extendOptions = extendOptions;
    Sub.sealedOptions = extend({}, Sub.options);

    // cache constructor 缓存
    cachedCtors[SuperId] = Sub;
    return Sub;
  };
}

function initProps(Comp) {
  const props = Comp.options.props;
  for (const key in props) {
    proxy(Comp.prototype, `_props`, key);
  }
}

function initComputed(Comp) {
  const computed = Comp.options.computed;
  for (const key in computed) {
    defineComputed(Comp.prototype, key, computed[key]);
  }
}
