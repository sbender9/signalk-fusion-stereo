# signalk-fusion-stereo

[![Greenkeeper badge](https://badges.greenkeeper.io/sbender9/signalk-fusion-stereo.svg)](https://greenkeeper.io/)

signalk-server-node plugin to control a Fusion stereo

# API

The stereo can be controled using PUT requests. These can be done via HTTP or over WebSockets.

Detailed info on [PUT](https://signalk.org/specification/1.3.0/doc/put.html) and [Request/Response](https://signalk.org/specification/1.3.0/doc/request_response.html)

Http:

```
PUT http://localhost:3000/signalk/v1/api/vessels/self/entertainment/device/fusion1/output/zone1/volume/master
{
  "value": 12
}
```

WebSockets:

```
{
  "context": "vessels.self",
  "requestId": "184743-434373-348483",
  "put": {
    "path": "entertainment.device.fusion1.output.zone1.volume.master",
    "value": 12
  }
}
```


## Set Volume

The value is a number between 0 and 24

```
PUT http://localhost:3000/signalk/v1/api/vessels/self/entertainment/device/fusion1/output/zone1/volume/master
{
  "value": 12
}
```

## Mute/UnMute
```
PUT http://localhost:3000/signalk/v1/api/vessels/self/entertainment/device/fusion1/output/zone1/isMuted
{
  "value": true
}
```

## Change the Source
```
PUT http://localhost:3000/signalk/v1/api/vessels/self/entertainment/device/fusion1/output/zone1/source
{
  "value": 'source2'
}
```

## Power On/Off

The value should be 'on' or 'off'

```
PUT http://localhost:3000/signalk/v1/api/vessels/self/entertainment/device/fusion1/state
{
  "value": 'on'
}
```

## Play/Pause/Prev/Next

```
PUT http://localhost:3000/signalk/v1/api/vessels/self/entertainment/device/fusion1/play
{
  "value": true
}
```

