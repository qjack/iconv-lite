var fs  = require("fs");
var zlib = require("zlib");
var crypto = require("crypto");
var Iconv  = require("iconv").Iconv;

/*
Information about multibyte encodings.
1. UTF-16: Encodes 1 BMP + 16 additional planes, 0x10000 code points each.
   -> BMP: 1:1 mapping, without range 0xD800-0xDFFF (which are reserved for surrogates)
   -> 'Surrogates': get (Code point - 0x10000), split by high and low 10 bits.
     -> First  surrogate: high 10 bits + 0xD800
     -> Second surrogate: low  10 bits + 0xDC00

2. ISO-2022: (Stateful) 7-bit encoding of large character sets. Each variation specifies
   several 'working sets' of chars, each 94^n or 96^n chars. Using control codes, 
   you can assign them to G0-G3 and then switch between them either only for 
   next char, or for all following chars.
   Variants:
   -> ISO-2022-JP (-1, -2, -3, -2004)
   -> -KR, -CN, -CN-EXT

3. EUC (Extended Unix Code): Multibyte stateless encoding based on ISO-2022.
   G0, single-byte, is coded as-is, and (almost) compatible to ASCII (ISO-646).
   G1, multi-byte, is coded with bit 8 set in both bytes, otherwise same as ISO-2022.
   -> EUC-CN: Usual form of GB2312. 1 or 2 bytes only. Rare modification called 
      "748" code uses second byte < 128.
   -> EUC-JP: Variable-width, represents JIS standards (X 0208, X0212, X 0201).
      Has 1-3 bytes. 3-bytes starts with 0x8F. EUC-JISX0213 - similar encoding, but
      uses JIS X 0213 instead of 0208 and 0212.
   -> EUC-KR: 1 or 2 bytes. CP949 is upward-compatible. Also MacKorean.
   -> EUC-TW: 1, 2 or 4 bytes. 4-bytes start with 0x8F, then plane number (0xA0-0xAF), 
      then 2-bytes character in plane.

4. GB18030: Multibyte encoding, compatible with ASCII, GB2312, which contains 
   all Unicode chars. Chinese gov standard. Almost compatible with GBK (except for
   the euro sign). Corresponding to Unicode is mostly via lookup tables.
   1, 2 or 4 bytes.

China:
  -> GB2312 (1980-s, widespread), 
  -> CP936 - Microsoft extension to GB2312. 
  -> GBK 1.0 - extension to CP936. Later Microsoft added Euro sign as 0x80, which
     is not valid GBK code.
  -> GB18030 - extension to GBK, which codifies all unicode code points.

Taiwan:
  -> Big5 is defacto standard. 2 bytes, first with 8-bit set, second-any.
     see http://moztw.org/docs/big5/. CP950 - MS variant.
  -> Big5HKSCS - extension for Hong Kong, aka CP951. 
     (http://me.abelcheung.org/articles/research/what-is-cp951/)

Japan:
  -> EUC-JP (see above)
  -> Shift-JIS: 1, 2 bytes. Modified ASCII. Extensions: CP932=Windows-31J, also 
     KDDI and others added.

Korea:
  -> EUC-KR, CP949, MacKorean.

North Korea:
  -> KPS 9566, ISO 2022-compliant (94x94 chars)

*/



var encodingFamilies = [
    {
        // Standard doublebyte tables
        encodings: ['gbk', 'gb2312', 'big5', 'euc-kr', 'cp936'],
        /*convert: function(cp) {
            return {
                name: "windows-"+cp,
                aliases: ["win"+cp, "cp"+cp, ""+cp],
            }
        }*/
    },
];


var encodings = {
    // Aliases.
    "euccn": "gb2312"
};

// Add all encodings from encodingFamilies.
encodingFamilies.forEach(function(family){
    family.encodings.forEach(function(encoding){
        if (family.convert)
            encoding = family.convert(encoding);

        var encodingIconvName = encoding.name ? encoding.name : encoding; 
        var encodingName = encodingIconvName.replace(/[-_]/g, "").toLowerCase();

        var filename = "./encodings/dbcs_tables/" + encodingName + ".bin.gz";
        writeTable(filename, encodingIconvName);

        encodings[encodingName] = {
            type: "dbcs",
            filename: filename,
        };

        if (encoding.aliases)
            encoding.aliases.forEach(function(alias){
                encodings[alias] = encodingName;
            });
    });
});

// Write encodings.
fs.writeFileSync("./encodings/dbcs.js", 
    "module.exports = " + JSON.stringify(encodings, undefined, "  ") + ";");


function writeTable(filename, encoding) {
    console.log("Generate table for " + encoding);
    var iconvToUtf8 = new Iconv(encoding, "UTF-8");
    var buf = new Buffer(0x80*0x100*2);

    // First, assert that first 128 chars are strictly equal to ASCII.
    for (var a = 0x00; a < 0x80; a++) {
        var encodedBuf = new Buffer([a]);
        var convertedChar = iconvToUtf8.convert(encodedBuf).toString();
        
        if (convertedChar.length != 1)
            throw new Error("Dbcs encoding error: Must return single char.");
        if (convertedChar.charCodeAt(0) != a)
            console.log("Dbcs encoding error: Lower char doesnt correspond to ASCII: a="+a+"; char="+convertedChar.charCodeAt(0))
    }

    // Fill the buffer.
    var i = 0;
    for (var a = 0x80; a < 0x100; a++) {
        for (var b = 0x00; b < 0x100; b++) {
            try {
                var encodedBuf = new Buffer([a,b]);
                var convertedChar = iconvToUtf8.convert(encodedBuf).toString();
                
                if (convertedChar.length != 1) {
                    console.log(encodedBuf, convertedChar);
                    throw new Error("Dbcs encoding error: Must return single char.");
                }
            } catch (exception) {
                if (exception.code === "EILSEQ") {
                    convertedChar = "\ufffd";
                } else if (exception.code === "EINVAL") {
                    console.log(encodedBuf);
                    throw exception;
                } else {
                    throw exception;
                }
            }

            buf.write(convertedChar, i, 2, 'ucs2');
            i += 2;
        }
    }

    // Write gzipped buffer.
    var gzip = zlib.createGzip();
    var fileStream = fs.createWriteStream(filename);
    gzip.pipe(fileStream);
    gzip.end(buf);

    // Calculate hash
    var hash = crypto.createHash('sha1').update(buf).digest('hex');
    console.log("Hash:", hash);
}
