import { initMixin } from "./init";
import { stateMixin } from "./state";
import { renderMixin } from "./render";
import { eventsMixin } from "./events";
import { lifecycleMixin } from "./lifecycle";
import { warn } from "../util/index";

/**
 * 定义了Vue的构造函数, 各个实例方法的初始化 */
function Vue(options) {
  if (process.env.NODE_ENV !== "production" && !(this instanceof Vue)) {
    warn("Vue is a constructor and should be called with the `new` keyword");
  }
  /** 调用Vue.prototype._init,方法在initMixin */
  this._init(options);
}

/**定义Vue.prototype._init */
initMixin(Vue);

/**
 * Vue.prototype.$data
 * Vue.prototype.$props
 * Vue.prototype.$set
 * Vue.prototype.$delete
 * Vue.prototype.$watch
 */
stateMixin(Vue);

/**
 * 定义事件相关的方法
 *    Vue.prototype.$on
 *    Vue.prototype.$once
 *    Vue.prototype.$off
 *    Vue.prototype.$emit
 */
eventsMixin(Vue);

/**
 * Vue.prototype._update
 * Vue.prototype.$forceUpdate
 * Vue.prototype.$destroy
 */
lifecycleMixin(Vue);

/**
 * 执行installRenderHelpers，在Vue.prototype 对象上安装允许时便利程序
 * 
 * Vue.prototype.$nextTick
 * Vue.prototype._render
 */
renderMixin(Vue);

export default Vue;
