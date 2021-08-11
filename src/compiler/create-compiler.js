/* @flow */

import { extend } from "shared/util";
import { detectErrors } from "./error-detector";
import { createCompileToFunctionFn } from "./to-function";

/**
 *
 * @param {*} baseCompile  核心编译器
 * @returns
 */
export function createCompilerCreator(baseCompile: Function): Function {
  /**
   * baseOptions： src/platforms/web/compiler/options
   */
  return function createCompiler(baseOptions: CompilerOptions) {
    /**
     * 编译函数
     *  1. 合并选项，将options配置项合并到finalOptions(baseOptions)中，得到最终的编译配置对象
     *  2. 调用核心编译器baseCompile得到编译结果
     *  3. 将编译期间产生的error和tip挂载到编译结果上返回编译结果
     * @param {*} template
     * @param {*} options
     * @returns
     */
    function compile(
      /**字符串模板 */
      template: string,
      /**编译选项 */
      options?: CompilerOptions
    ): CompiledResult {
      /**平台特有的编译选项 比如web平台， 以平台特有的编译选项为原型创建最终的编译配置 */
      const finalOptions = Object.create(baseOptions);
      const errors = [];
      const tips = [];

      /**日志，负责记录error和tip */
      let warn = (msg, range, tip) => {
        (tip ? tips : errors).push(msg);
      };

      /**
       * 存在编译选项，合并options配置和baseOptions， 将两者合并到finalOptions对象上
       */
      if (options) {
        /**开发环境 */
        if (
          process.env.NODE_ENV !== "production" &&
          options.outputSourceRange
        ) {
          // $flow-disable-line
          const leadingSpaceLength = template.match(/^\s*/)[0].length;
          /**增强日志 */
          warn = (msg, range, tip) => {
            const data: WarningMessage = { msg };
            if (range) {
              if (range.start != null) {
                data.start = range.start + leadingSpaceLength;
              }
              if (range.end != null) {
                data.end = range.end + leadingSpaceLength;
              }
            }
            (tip ? tips : errors).push(data);
          };
        }

        /**
         * merge custom modules
         * 将options中的配置项合并到finalOptions
         */

        /**合并自定义module */
        if (options.modules) {
          finalOptions.modules = (baseOptions.modules || []).concat(
            options.modules
          );
        }
        // merge custom directives
        /**合并自定义指令 */
        if (options.directives) {
          finalOptions.directives = extend(
            Object.create(baseOptions.directives || null),
            options.directives
          );
        }
        // copy other options
        /**拷贝其他配置项 */
        for (const key in options) {
          if (key !== "modules" && key !== "directives") {
            finalOptions[key] = options[key];
          }
        }
      }

      /**日志 */
      finalOptions.warn = warn;

      /**
       * 执行baseCompile得到编译结果
       * 调用核心编译函数，传递模板字符串和最终编译配置选项，得到编译结果
       * 前面做的所有事情都是为了构建平台最终的配置选项
       */
      const compiled = baseCompile(template.trim(), finalOptions);
      if (process.env.NODE_ENV !== "production") {
        detectErrors(compiled.ast, warn);
      }
      /**执行期间产生的错误和tips挂载到编译结果上 */
      compiled.errors = errors;
      compiled.tips = tips;

      /**返回编译结果 */
      return compiled;
    }

    return {
      compile,
      compileToFunctions: createCompileToFunctionFn(compile),
    };
  };
}
