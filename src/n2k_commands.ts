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

import {
  PGN,
  PGN_126720_FusionMediaControl,
  PGN_126720_FusionSiriusControl,
  PGN_126720_FusionRequestStatus,
  PGN_126720_FusionSetMute,
  PGN_126720_FusionSetSource,
  PGN_126720_FusionSetZoneVolume,
  PGN_126720_FusionSetAllVolumes,
  PGN_126720_FusionSetPower,
  FusionCommand,
  FusionSiriusCommand,
  FusionMuteCommand,
  FusionPowerState
} from '@canboat/ts-pgns'
import util from 'util'

const fusion_commands: {
  [key: string]: string | ((sourceId: number, dst: number) => PGN)
} = {
  //next: '%s,6,126720,%s,%s,6,a3,99,03,00,%s,04',
  next: (sourceId: number, dst: number) =>
    new PGN_126720_FusionMediaControl(
      {
        command: FusionCommand.Next,
        sourceId
      },
      dst
    ),
  //prev: '%s,6,126720,%s,%s,6,a3,99,03,00,%s,06',
  prev: (sourceId: number, dst: number) =>
    new PGN_126720_FusionMediaControl(
      {
        command: FusionCommand.Prev,
        sourceId
      },
      dst
    ),
  //play: '%s,6,126720,%s,%s,6,a3,99,03,00,%s,01',
  play: (sourceId: number, dst: number) =>
    new PGN_126720_FusionMediaControl(
      {
        command: FusionCommand.Play,
        sourceId
      },
      dst
    ),
  //pause: '%s,6,126720,%s,%s,6,a3,99,03,00,%s,02',
  pause: (sourceId: number, dst: number) =>
    new PGN_126720_FusionMediaControl(
      {
        command: FusionCommand.Pause,
        sourceId
      },
      dst
    ),
  //SiriusXM_next: '%s,7,126720,%s,%s,8,a3,99,1e,00,%s,01,00,00',
  SiriusXM_next: (sourceId: number, dst: number) =>
    new PGN_126720_FusionSiriusControl(
      {
        command: FusionSiriusCommand.Next,
        sourceId
      },
      dst
    ),
  //SiriusXM_prev: '%s,7,126720,%s,%s,8,a3,99,1e,00,%s,02,00,00',
  SiriusXM_prev: (sourceId: number, dst: number) =>
    new PGN_126720_FusionSiriusControl(
      {
        command: FusionSiriusCommand.Prev,
        sourceId
      },
      dst
    ),
  //status: '%s,6,126720,%s,%s,4,a3,99,01,00',
  status: (_sourceId: number, dst: number) =>
    new PGN_126720_FusionRequestStatus({}, dst),
  //mute: '%s,6,126720,%s,%s,5,a3,99,11,00,01',
  mute: (_sourceId: number, dst: number) =>
    new PGN_126720_FusionSetMute(
      {
        command: FusionMuteCommand.MuteOn
      },
      dst
    ),
  //unmute: '%s,6,126720,%s,%s,5,a3,99,11,00,02',
  unmute: (_sourceId: number, dst: number) =>
    new PGN_126720_FusionSetMute(
      {
        command: FusionMuteCommand.MuteOff
      },
      dst
    ),
  //setSource: '%s,6,126720,%s,%s,5,a3,99,02,00,%s',
  setSource: (sourceId: number, dst: number) =>
    new PGN_126720_FusionSetSource(
      {
        sourceId
      },
      dst
    ),
  //poweron: '%s,6,126720,%s,%s,5,a3,99,1c,00,01',
  poweron: (_sourceId: number, dst: number) =>
    new PGN_126720_FusionSetPower(
      {
        power: FusionPowerState.On
      },
      dst
    ),
  //poweroff: '%s,6,126720,%s,%s,5,a3,99,1c,00,02',
  poweroff: (_sourceId: number, dst: number) =>
    new PGN_126720_FusionSetPower(
      {
        power: FusionPowerState.Off
      },
      dst
    ),
  setBTDevice: '%s,7,126720,%s,%s,11,a3,99,09,00,0b,%s,00,00,00,02,02'
}

//setVolume: '%s,6,126720,%s,%s,6,a3,99,18,00,%s,%s',
//setAllVolume: '%s,6,126720,%s,%s,8,a3,99,19,00,%s,%s,%s,%s',

const default_src = '1'

function checkVolume(val: number) {
  return typeof val !== 'undefined' ? val : 0
}

function zoneIdToNum(id: string) {
  return Number(id.substring('zone'.length)) - 1
}

function sourceidToNum(id: string) {
  return id !== undefined ? Number(id.substring('source'.length)) : 0
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
): string | PGN | undefined {
  let n2k_msg = null
  let action = command_json['action']

  if (action == 'setAllVolume') {
    const volumes = command_json['value']

    const zone1 = checkVolume(volumes['zone1'])
    const zone2 = checkVolume(volumes['zone2'])
    const zone3 = checkVolume(volumes['zone3'])
    const zone4 = checkVolume(volumes['zone4'])

    n2k_msg = new PGN_126720_FusionSetAllVolumes(
      {
        zone1,
        zone2,
        zone3,
        zone4
      },
      deviceid
    )
  } else if (action == 'setVolume') {
    n2k_msg = new PGN_126720_FusionSetZoneVolume(
      {
        zone: zoneIdToNum(command_json['zone']),
        volume: command_json['value']
      },
      deviceid
    )
  } else {
    if (
      action == 'next' ||
      action == 'prev' ||
      action == 'play' ||
      action == 'pause'
    ) {
      action = currentSource == 'SiriusXM' ? `SiriusXM_${action}` : action
    }

    const format = fusion_commands[action]

    if (format === undefined) {
      return undefined
    }

    if (typeof format !== 'string') {
      let sourceId: number
      if (action === 'setSource') {
        sourceId = sourceidToNum(command_json['value'])
      } else {
        sourceId = sourceidToNum(cur_source_id)
      }
      n2k_msg = format(sourceId, deviceid)
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
  }

  return n2k_msg
}
