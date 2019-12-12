'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _events = require('events');

var _events2 = _interopRequireDefault(_events);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

let AudioCtx = function (_EventEmitter) {
  _inherits(AudioCtx, _EventEmitter);

  function AudioCtx(config) {
    _classCallCheck(this, AudioCtx);

    var _this2 = _possibleConstructorReturn(this, (AudioCtx.__proto__ || Object.getPrototypeOf(AudioCtx)).call(this));

    _this2.config = Object.assign({}, config);
    let AudioContext = window.AudioContext || window.webkitAudioContext;
    _this2.context = new AudioContext();
    _this2.gainNode = _this2.context.createGain();
    _this2.gainNode.connect(_this2.context.destination);
    _this2.meta = undefined;
    _this2.samples = [];
    _this2.preloadTime = _this2.config.preloadTime || 3;
    _this2.duration = 0;

    _this2._currentBuffer = undefined;
    _this2._nextBuffer = undefined;
    _this2._lastpts = undefined;
    _this2._preDecode = [];
    _this2._currentTime = 0;
    _this2._decoding = false;
    _this2._volume = _this2.config.volume || 0.6;
    // 记录外部传输的状态
    _this2._played = false;
    _this2.playFinish = null; // pending play task
    _this2.waitNextID = null; // audio source end and next source not loaded
    return _this2;
  }

  _createClass(AudioCtx, [{
    key: 'decodeAudio',
    value: function decodeAudio(audioTrack) {
      let { samples } = audioTrack;
      let data = samples;
      audioTrack.samples = [];
      this.setAudioData(data);
    }
  }, {
    key: 'setAudioData',
    value: function setAudioData(data) {
      for (let i = 0; i < data.length; i++) {
        data[i].pts = data[i].pts === undefined ? data[i].dts : data[i].pts;
        this._preDecode.push(data[i]);
      }
      if (this._preDecode.length > 0) {
        if (this._lastpts === undefined) {
          this._lastpts = this._preDecode[0].pts;
        }
        if ((this._preDecode[this._preDecode.length - 1].pts - this._lastpts) / 1000 > this.preloadTime) {
          this.decodeAAC();
        }
      }
    }
  }, {
    key: 'decodeAAC',
    value: function decodeAAC() {
      if (this._decoding) {
        return;
      }
      this._decoding = true;
      let data = this._preDecode;
      let samples = [];
      let _this = this;
      let sample = data.shift();
      while (sample) {
        let sampleData = AudioCtx.getAACData(this.meta, sample);
        samples.push(sampleData);
        this._lastpts = sample.pts;
        sample = data.shift();
      }
      let buffer = AudioCtx.combileData(samples);
      try {
        this.context.decodeAudioData(buffer.buffer, function (buffer) {
          let audioSource = _this.context.createBufferSource();
          audioSource.buffer = buffer;
          // audioSource.onended = _this.onSourceEnded.bind(_this);
          _this.samples.push({
            time: _this.duration,
            duration: buffer.duration,
            data: audioSource
          });

          _this.duration += buffer.duration;

          if (!_this._currentBuffer) {
            _this._currentBuffer = _this.getTimeBuffer(_this.currentTime);
          }

          if (!_this._nextBuffer && _this._currentBuffer) {
            _this._nextBuffer = _this.getTimeBuffer(_this.currentTime + _this._currentBuffer.duration);
          }
          _this._decoding = false;

          if ((_this._preDecode.length > 0 && _this._preDecode[_this._preDecode.length - 1].pts - _this._lastpts) / 1000 >= _this.preloadTime) {
            _this.decodeAAC();
          }

          if (_this.playFinish) {
            _this.playFinish();
          }
        }, e => {
          console.error(e);
        });
      } catch (err) {
        console.error(err);
      }
    }
  }, {
    key: 'onSourceEnded',
    value: function onSourceEnded() {
      if (!this._nextBuffer || !this._played) {
        this.waitNextID = setTimeout(() => {
          this.onSourceEnded();
        }, 200);
        return;
      }
      let audioSource = this._nextBuffer.data;
      audioSource.start();
      audioSource.connect(this.gainNode);
      let _this = this;
      setTimeout(() => {
        _this.onSourceEnded.call(this);
      }, audioSource.buffer.duration * 1000 - 10);
      this._currentBuffer = this._nextBuffer;
      this._currentTime = this._currentBuffer.time;
      this._nextBuffer = this.getTimeBuffer(this.currentTime);
      if (this._currentBuffer) {
        this._nextBuffer = this.getTimeBuffer(this.currentTime + this._currentBuffer.duration);
      }
      this.emit('AUDIO_SOURCE_END');
    }
  }, {
    key: 'play',
    value: function play() {
      if (this.playFinish) {
        return;
      }
      this._played = true;
      if (this.context.state === 'suspended') {
        this.context.resume();
      }
      let _this = this;
      const playStart = () => {
        let audioSource = this._currentBuffer.data;
        audioSource.connect(this.gainNode);
        audioSource.start();
        setTimeout(() => {
          _this.onSourceEnded.call(this);
        }, audioSource.buffer.duration * 1000 - 10);
      };

      if (!this._currentBuffer) {
        return new Promise(resolve => {
          this.playFinish = resolve;
        }).then(() => {
          this.playFinish = null;
          playStart();
        });
      } else {
        playStart();
        return Promise.resolve();
      }
    }
  }, {
    key: 'pause',
    value: function pause() {
      const audioCtx = this.context;
      if (audioCtx.state === 'running') {
        audioCtx.suspend();
      }
    }
  }, {
    key: 'getTimeBuffer',
    value: function getTimeBuffer(time) {
      let ret;
      for (let i = 0; i < this.samples.length; i++) {
        let sample = this.samples[i];
        if (sample.time <= time && sample.time + sample.duration > time) {
          ret = sample;
          break;
        }
      }
      return ret;
    }
  }, {
    key: 'setAudioMetaData',
    value: function setAudioMetaData(meta) {
      this.meta = meta;
    }
  }, {
    key: 'destroy',
    value: function destroy() {
      if (this.waitNextID) {
        window.clearTimeout(this.waitNextID);
      }
      this.context.close();
    }
  }, {
    key: 'currentTime',
    get: function () {
      return this._currentTime;
    }
  }, {
    key: 'muted',
    set: function (val) {
      if (val) {
        this.gainNode.gain.value = 0;
      } else {
        this.gainNode.gain.value = this._volume;
      }
    }
  }, {
    key: 'volume',
    get: function () {
      return this._volume;
    },
    set: function (val) {
      if (val < 0) {
        this._volume = 0;
        this.gainNode.gain.value = 0;
        return;
      } else if (val > 1) {
        this._volume = 1;
        this.gainNode.gain.value = 1;
        return;
      }

      this._volume = val;
      this.gainNode.gain.value = val;
    }
  }], [{
    key: 'getAACData',
    value: function getAACData(meta, sample) {
      let buffer = new Uint8Array(sample.data.byteLength + 7);
      let adts = AudioCtx.getAdts(meta, sample.data);
      buffer.set(adts);
      buffer.set(sample.data, 7);
      return buffer;
    }
  }, {
    key: 'combileData',
    value: function combileData(samples) {
      // get length
      let length = 0;
      for (let i = 0, k = samples.length; i < k; i++) {
        length += samples[i].byteLength;
      }

      let ret = new Uint8Array(length);
      let offset = 0;
      // combile data;
      for (let i = 0, k = samples.length; i < k; i++) {
        ret.set(samples[i], offset);
        offset += samples[i].byteLength;
      }
      return ret;
    }
  }, {
    key: 'getAdts',
    value: function getAdts(meta, data) {
      let adts = new Uint8Array(7);

      // 设置同步位 0xfff 12bit
      adts[0] = 0xff;
      adts[1] = 0xf0;

      // Object data (没什么人用MPEG-2了，HLS和FLV也全是MPEG-4，这里直接0)  1bit
      // Level always 00 2bit
      // CRC always 1 1bit
      adts[1] = adts[1] | 0x01;

      // profile 2bit
      adts[2] = 0xc0 & meta.objectType - 1 << 6;

      // sampleFrequencyIndex
      adts[2] = adts[2] | 0x3c & meta.sampleRateIndex << 2;

      // private bit 0 1bit
      // chanel configuration 3bit
      adts[2] = adts[2] | 0x01 & meta.channelCount >> 2;
      adts[3] = 0xc0 & meta.channelCount << 6;

      // original_copy: 0 1bit
      // home: 0 1bit

      // adts_variable_header()
      // copyrighted_id_bit 0 1bit
      // copyrighted_id_start 0 1bit

      // aac_frame_length 13bit;
      let aacframelength = data.byteLength + 7;

      adts[3] = adts[3] | 0x03 & aacframelength >> 11;
      adts[4] = 0xff & aacframelength >> 3;
      adts[5] = 0xe0 & aacframelength << 5;

      // adts_buffer_fullness 0x7ff 11bit
      adts[5] = adts[5] | 0x1f;
      adts[6] = 0xfc;

      // number_of_raw_data_blocks_in_frame 0 2bit;
      return adts;
    }
  }]);

  return AudioCtx;
}(_events2.default);

exports.default = AudioCtx;