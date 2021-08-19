/* @flow */

import on from "./on";
import bind from "./bind";
import { noop } from "shared/util";

export default {
  on /**包装事件 */,
  bind /*包装数据* */,
  cloak: noop /**空函数 */,
};
