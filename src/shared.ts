/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export interface Disposable {
  dispose(): void;
}

export interface StateProvider {
  toState(): Promise<any>;
}

export function into(json: any, template: any): any {
  function error(message: string): void {
    throw new Error(`${message}: ${JSON.stringify(json)}`);
  }

  if (Array.isArray(template)) {
    if (json === undefined || json === null) {
      return [];
    }

    if (!Array.isArray(json)) {
      error('Unable to convert to an array.');
    }

    if (template.length !== 1) {
      error('Invalid template');
    }

    return json.map((v: any) => into(v, template[0]));
  }

  if ((typeof json) !== (typeof template)) {
    error('Type mismatch.');
  }

  if (typeof json === 'object') {
    let result: any = {};
    for (let key of Object.keys(template)) {
      result[key] = into(json[key], template[key]);
    }

    return result;
  } else {
    return json;
  }
}
