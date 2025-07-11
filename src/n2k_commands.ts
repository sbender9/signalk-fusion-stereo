/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 * Copyright 2016 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import util from 'util'

const fusion_commands: { [key: string]: string } = {
  next: '%s,6,126720,%s,%s,6,a3,99,03,00,%s,04',
  prev: '%s,6,126720,%s,%s,6,a3,99,03,00,%s,06',
  SiriusXM_next: '%s,7,126720,%s,%s,8,a3,99,1e,00,%s,01,00,00',
  SiriusXM_prev: '%s,7,126720,%s,%s,8,a3,99,1e,00,%s,02,00,00',
  play: '%s,6,126720,%s,%s,6,a3,99,03,00,%s,01',
  pause: '%s,6,126720,%s,%s,6,a3,99,03,00,%s,02',
  status: '%s,6,126720,%s,%s,4,a3,99,01,00',
  mute: '%s,6,126720,%s,%s,5,a3,99,11,00,01',
  unmute: '%s,6,126720,%s,%s,5,a3,99,11,00,02',
  setSource: '%s,6,126720,%s,%s,5,a3,99,02,00,%s',
  setVolume: '%s,6,126720,%s,%s,6,a3,99,18,00,%s,%s',
  setAllVolume: '%s,6,126720,%s,%s,8,a3,99,19,00,%s,%s,%s,%s',
  poweron: '%s,6,126720,%s,%s,5,a3,99,1c,00,01',
  poweroff: '%s,6,126720,%s,%s,5,a3,99,1c,00,02',
  setBTDevice: '%s,7,126720,%s,%s,11,a3,99,09,00,0b,%s,00,00,00,02,02'
}

const default_src = '1'

function checkVolume(val: number) {
  return typeof val !== 'undefined' ? val : 0
}

export function zoneIdToNum(id: string) {
  return padd((Number(id.substring('zone'.length)) - 1).toString(16))
}

export function sourceidToNum(id: string) {
  return padd(Number(id.substring('source'.length)).toString(16))
}

function isoDate() {
  return new Date().toISOString()
}

function padd(
  n: string,
  p: number | undefined = undefined,
  c: string | undefined = undefined
) {
  const pad_count = typeof p !== 'undefined' ? p : 2
  const pad_char = typeof c !== 'undefined' ? c : '0'
  const pad = new Array(1 + pad_count).join(pad_char)
  return (pad + n).slice(-pad.length)
}

export function getN2KCommand(
  deviceid: number,
  command_json: any,
  currentSource: string,
  cur_source_id: string
) {
  let n2k_msg = null
  const action = command_json['action']

  let format = fusion_commands[action]
  if (action == 'setSource') {
    n2k_msg = util.format(
      format,
      isoDate(),
      default_src,
      deviceid,
      sourceidToNum(command_json['value'])
    )
  } else if (action == 'setAllVolume') {
    const volumes = command_json['value']

    const zone1 = checkVolume(volumes['zone1'])
    const zone2 = checkVolume(volumes['zone2'])
    const zone3 = checkVolume(volumes['zone3'])
    const zone4 = checkVolume(volumes['zone4'])

    n2k_msg = util.format(
      format,
      isoDate(),
      default_src,
      deviceid,
      padd(zone1.toString(16)),
      padd(zone2.toString(16)),
      padd(zone3.toString(16)),
      padd(zone4.toString(16))
    )
  } else if (action == 'setVolume') {
    n2k_msg = util.format(
      format,
      isoDate(),
      default_src,
      deviceid,
      zoneIdToNum(command_json['zone']),
      padd(command_json['value'].toString(16))
    )
  } else if (
    action == 'next' ||
    action == 'prev' ||
    action == 'play' ||
    action == 'pause'
  ) {
    if (currentSource == 'SiriusXM') {
      format = fusion_commands['SiriusXM_' + action]
    }

    if (format) {
      n2k_msg = util.format(
        format,
        isoDate(),
        default_src,
        deviceid,
        sourceidToNum(cur_source_id)
      )
    }
  } else if (action === 'setBTDevice') {
    n2k_msg = util.format(
      format,
      isoDate(),
      default_src,
      deviceid,
      padd(command_json['value'].toString(16))
    )
  } else {
    n2k_msg = util.format(format, isoDate(), default_src, deviceid)
  }

  return n2k_msg
}
