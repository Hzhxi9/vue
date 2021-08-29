/* @flow */

import { isRegExp, remove } from "shared/util";
import { getFirstComponentChild } from "core/vdom/helpers/index";

type CacheEntry = {
  name: ?string,
  tag: ?string,
  componentInstance: Component,
};

type CacheEntryMap = { [key: string]: ?CacheEntry };

function getComponentName(opts: ?VNodeComponentOptions): ?string {
  return opts && (opts.Ctor.options.name || opts.tag);
}

function matches(
  pattern: string | RegExp | Array<string>,
  name: string
): boolean {
  if (Array.isArray(pattern)) {
    return pattern.indexOf(name) > -1;
  } else if (typeof pattern === "string") {
    return pattern.split(",").indexOf(name) > -1;
  } else if (isRegExp(pattern)) {
    return pattern.test(name);
  }
  /* istanbul ignore next */
  return false;
}

function pruneCache(keepAliveInstance: any, filter: Function) {
  const { cache, keys, _vnode } = keepAliveInstance;
  for (const key in cache) {
    const entry: ?CacheEntry = cache[key];
    if (entry) {
      const name: ?string = entry.name;
      if (name && !filter(name)) {
        pruneCacheEntry(cache, key, keys, _vnode);
      }
    }
  }
}

function pruneCacheEntry(
  cache: CacheEntryMap,
  key: string,
  keys: Array<string>,
  current?: VNode
) {
  const entry: ?CacheEntry = cache[key];
  if (entry && (!current || entry.tag !== current.tag)) {
    entry.componentInstance.$destroy();
  }
  cache[key] = null;
  remove(keys, key);
}

const patternTypes: Array<Function> = [String, RegExp, Array];

export default {
  name: "keep-alive",
  abstract: true /**抽象组件 */,

  props: {
    include: patternTypes /**要缓存的组件  */,
    exclude: patternTypes /**要排除的组件 */,
    max: [String, Number] /**最大缓存树 */,
  },

  methods: {
    cacheVNode() {
      const { cache, keys, vnodeToCache, keyToCache } = this;
      if (vnodeToCache) {
        const { tag, componentInstance, componentOptions } = vnodeToCache;

        /**没找到就缓存下来 */
        cache[keyToCache] = {
          name: getComponentName(componentOptions),
          tag,
          componentInstance,
        };
        /**把他放到数组末尾 */
        keys.push(keyToCache);
        // prune oldest entry

        /**
         * 如果缓存中组件的个数超过传入的max, 销毁缓存中的LRU组件
         * 超过最大值就把数组第0项删掉
         * LRU: 最近最少用， 缓存淘汰策略
         */
        if (this.max && keys.length > parseInt(this.max)) {
          pruneCacheEntry(cache, keys[0], keys, this._vnode);
        }
        this.vnodeToCache = null;
      }
    },
  },

  created() {
    /**
     * 存储需要缓存的组件
     * { a:VNode, b: VNode }
     */
    this.cache = Object.create(null);

    /**
     * 存储每个需要缓存的key
     * 即对应this.cache对象中的键值
     * [a,b]
     */
    this.keys = [];
  },

  /**
   * 销毁keep-alive组件的时候，对缓存中的每个组件执行销毁
   */
  destroyed() {
    for (const key in this.cache) {
      pruneCacheEntry(this.cache, key, this.keys);
    }
  },

  mounted() {
    this.cacheVNode();

    /**动态监听include, exclude */
    this.$watch("include", (val) => {
      pruneCache(this, (name) => matches(val, name));
    });
    this.$watch("exclude", (val) => {
      pruneCache(this, (name) => !matches(val, name));
    });
  },

  updated() {
    this.cacheVNode();
  },

  render() {
    const slot = this.$slots.default;
    const vnode: VNode = getFirstComponentChild(slot);

    /**如果VNode存在就取VNode的选项 */
    const componentOptions: ?VNodeComponentOptions =
      vnode && vnode.componentOptions;

    if (componentOptions) {
      // check pattern

      /**获取第一个有效组件的name */
      const name: ?string = getComponentName(componentOptions);
      const { include, exclude } = this;
      if (
        // not included
        (include && (!name || !matches(include, name))) ||
        // excluded
        (exclude && name && matches(exclude, name))
      ) {
        /**说明不需要缓存，直接返回这个组件进行渲染 */
        return vnode;
      }

      /**匹配到了，开始缓存操作 */

      /**keep-value组件缓存组件和缓存组件对应的key */
      const { cache, keys } = this;

      /**获取到第一个有效组件的key */
      const key: ?string =
        vnode.key == null
          ? // same constructor may get registered as different local components
            // so cid alone is not enough (#3269)
            componentOptions.Ctor.cid +
            (componentOptions.tag ? `::${componentOptions.tag}` : "")
          : vnode.key;

      if (cache[key]) {
        /**
         * 通过key找到缓存，获取实例
         * 这个组件的实例用缓存中的组件实例替换
         **/
        vnode.componentInstance = cache[key].componentInstance;

        // make current key freshest 更新当前key在keys中的位子
        remove(keys, key); /**通过LRU算法把数组里面的key删掉 */
        keys.push(key); /**把它放到数组末尾 */
      } else {
        // delay setting the cache until update
        this.vnodeToCache = vnode;
        this.keyToCache = key;
      }

      vnode.data.keepAlive = true;
    }

    /**
     * 若第一个有效的组件存在，但其componentOptions不存在，就返回这个组件进行渲染
     * 或若也不存在有效的第一个组件，但keep-alive组件的默认插槽存在，就返回默认插槽的第一个组件进行渲染
     */
    return vnode || (slot && slot[0]);
  },
};
