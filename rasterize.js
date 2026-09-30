/* GLOBAL CONSTANTS AND VARIABLES */

/* assignment specific globals */
const WIN_Z = 0;
const WIN_LEFT = 0;
const WIN_RIGHT = 1;
const WIN_BOTTOM = 0;
const WIN_TOP = 1;

const INPUT_TRIANGLES_URL =
    "https://ncsucgclass.github.io/prog2/triangles.json";

var Eye = new vec4.fromValues(0.5, 0.5, -0.5, 1.0);

/* webGL globals */
var gl = null;
var vertexBuffer;
var colorBuffer;
var triangleBuffer;
var triBufferSize;
var vertexPositionAttrib;
var vertexColorAttrib;

var originalVertices = [];
var originalColors = [];
var originalIndices = [];
var customMode = false;


// ASSIGNMENT HELPER FUNCTIONS

// get the JSON file from the passed URL
function getJSONFile(url, descr) {
    try {
        if ((typeof(url) !== "string") || (typeof(descr) !== "string"))
            throw "getJSONFile: parameter not a string";
        else {
            var httpReq = new XMLHttpRequest();
            httpReq.open("GET", url, false);
            httpReq.send(null);

            var startTime = Date.now();
            while ((httpReq.status !== 200) &&
                   (httpReq.readyState !== XMLHttpRequest.DONE)) {

                if ((Date.now() - startTime) > 3000)
                    break;
            }

            if ((httpReq.status !== 200) ||
                (httpReq.readyState !== XMLHttpRequest.DONE))
                throw "Unable to open " + descr + " file!";
            else
                return JSON.parse(httpReq.response);
        }
    }
    catch(e) {
        console.log(e);
        return(String.null);
    }
}


// set up the webGL environment
function setupWebGL() {

    var canvas = document.getElementById("myWebGLCanvas");

    gl = canvas.getContext("webgl");

    try {
        if (gl == null) {
            throw "unable to create gl context -- is your browser gl ready?";
        } else {
            gl.clearColor(0.0, 0.0, 0.0, 1.0);
            gl.clearDepth(1.0);

            gl.enable(gl.DEPTH_TEST);

            // Make sure triangles with either winding direction render
            gl.disable(gl.CULL_FACE);
        }
    }
    catch(e) {
        console.log(e);
    }
}


// read triangles in, load them into webgl buffers
function loadTriangles() {

    var inputTriangles =
        getJSONFile(INPUT_TRIANGLES_URL, "triangles");

    if (inputTriangles != String.null) {

        var whichSetVert;
        var whichSetTri;
        var coordArray = [];
        var colorArray = [];
        var indexArray = [];

        for (var whichSet = 0;
             whichSet < inputTriangles.length;
             whichSet++) {

            var vertexOffset = coordArray.length / 3;

            // set up the vertex coord array
            for (whichSetVert = 0;
                 whichSetVert < inputTriangles[whichSet].vertices.length;
                 whichSetVert++) {

                coordArray = coordArray.concat(
                    inputTriangles[whichSet].vertices[whichSetVert]
                );

                colorArray = colorArray.concat(
                    inputTriangles[whichSet].material.diffuse
                );
            }

            // set up the triangle index array
            for (whichSetTri = 0;
                 whichSetTri < inputTriangles[whichSet].triangles.length;
                 whichSetTri++) {

                indexArray.push(
                    inputTriangles[whichSet].triangles[whichSetTri][0]
                    + vertexOffset
                );

                indexArray.push(
                    inputTriangles[whichSet].triangles[whichSetTri][1]
                    + vertexOffset
                );

                indexArray.push(
                    inputTriangles[whichSet].triangles[whichSetTri][2]
                    + vertexOffset
                );
            }
        }

        originalVertices = coordArray.slice();
        originalColors = colorArray.slice();
        originalIndices = indexArray.slice();

        // send the vertex coords to WebGL
        vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array(coordArray),
            gl.STATIC_DRAW
        );

        // send colors to WebGL
        colorBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.bufferData(
            gl.ARRAY_BUFFER,
            new Float32Array(colorArray),
            gl.STATIC_DRAW
        );

        // send triangle indices to WebGL
        triangleBuffer = gl.createBuffer();
        gl.bindBuffer(
            gl.ELEMENT_ARRAY_BUFFER,
            triangleBuffer
        );
        gl.bufferData(
            gl.ELEMENT_ARRAY_BUFFER,
            new Uint16Array(indexArray),
            gl.STATIC_DRAW
        );

        triBufferSize = indexArray.length;
    }
}


// setup the WebGL shaders
function setupShaders() {

    // fragment shader
    var fShaderCode = `
        precision mediump float;

        varying vec3 vColor;

        void main(void) {
            gl_FragColor = vec4(vColor, 1.0);
        }
    `;

    // vertex shader
    var vShaderCode = `
        attribute vec3 vertexPosition;
        attribute vec3 color;

        varying vec3 vColor;

        void main(void) {
            gl_Position = vec4(vertexPosition, 1.0);
            vColor = color;
        }
    `;

    try {
        var fShader = gl.createShader(gl.FRAGMENT_SHADER);

        gl.shaderSource(
            fShader,
            fShaderCode
        );

        gl.compileShader(fShader);


        var vShader = gl.createShader(gl.VERTEX_SHADER);

        gl.shaderSource(
            vShader,
            vShaderCode
        );

        gl.compileShader(vShader);


        if (!gl.getShaderParameter(
                fShader,
                gl.COMPILE_STATUS)) {

            throw "error during fragment shader compile: "
                + gl.getShaderInfoLog(fShader);

        } else if (!gl.getShaderParameter(
                       vShader,
                       gl.COMPILE_STATUS)) {

            throw "error during vertex shader compile: "
                + gl.getShaderInfoLog(vShader);

        } else {

            var shaderProgram = gl.createProgram();

            gl.attachShader(
                shaderProgram,
                fShader
            );

            gl.attachShader(
                shaderProgram,
                vShader
            );

            gl.linkProgram(shaderProgram);


            if (!gl.getProgramParameter(
                    shaderProgram,
                    gl.LINK_STATUS)) {

                throw "error during shader program linking: "
                    + gl.getProgramInfoLog(shaderProgram);

            } else {

                gl.useProgram(shaderProgram);

                vertexPositionAttrib =
                    gl.getAttribLocation(
                        shaderProgram,
                        "vertexPosition"
                    );

                gl.enableVertexAttribArray(
                    vertexPositionAttrib
                );

                vertexColorAttrib =
                    gl.getAttribLocation(
                        shaderProgram,
                        "color"
                    );

                gl.enableVertexAttribArray(
                    vertexColorAttrib
                );
            }
        }
    }
    catch(e) {
        console.log(e);
    }
}


// render the loaded model
function renderTriangles() {

    gl.clear(
        gl.COLOR_BUFFER_BIT |
        gl.DEPTH_BUFFER_BIT
    );

    // vertex positions
    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        vertexBuffer
    );

    gl.vertexAttribPointer(
        vertexPositionAttrib,
        3,
        gl.FLOAT,
        false,
        0,
        0
    );

    // vertex colors
    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        colorBuffer
    );

    gl.vertexAttribPointer(
        vertexColorAttrib,
        3,
        gl.FLOAT,
        false,
        0,
        0
    );

    // triangle indices
    gl.bindBuffer(
        gl.ELEMENT_ARRAY_BUFFER,
        triangleBuffer
    );

    gl.drawElements(
        gl.TRIANGLES,
        triBufferSize,
        gl.UNSIGNED_SHORT,
        0
    );
}


// create custom image
function createCustomImage() {

    var vertices = [];
    var colors = [];
    var indices = [];

    var numberOfTriangles = 12;
    var radius = 0.8;

    for (var i = 0;
         i < numberOfTriangles;
         i++) {

        var angle1 =
            (i / numberOfTriangles) * Math.PI * 2;

        var angle2 =
            ((i + 1) / numberOfTriangles) *
            Math.PI * 2;

        var x1 =
            Math.cos(angle1) * radius;

        var y1 =
            Math.sin(angle1) * radius;

        var x2 =
            Math.cos(angle2) * radius;

        var y2 =
            Math.sin(angle2) * radius;

        var vertexOffset =
            vertices.length / 3;

        vertices.push(
            0.0,
            0.0,
            0.5
        );

        vertices.push(
            x1,
            y1,
            0.5
        );

        vertices.push(
            x2,
            y2,
            0.5
        );

        var r =
            0.5 +
            0.5 * Math.cos(angle1);

        var g =
            0.5 +
            0.5 * Math.cos(angle1 + 2.094);

        var b =
            0.5 +
            0.5 * Math.cos(angle1 + 4.188);

        for (var j = 0;
             j < 3;
             j++) {

            colors.push(r);
            colors.push(g);
            colors.push(b);
        }

        indices.push(vertexOffset);
        indices.push(vertexOffset + 1);
        indices.push(vertexOffset + 2);
    }

    // vertex buffer
    vertexBuffer = gl.createBuffer();

    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        vertexBuffer
    );

    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(vertices),
        gl.STATIC_DRAW
    );

    // color buffer
    colorBuffer = gl.createBuffer();

    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        colorBuffer
    );

    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(colors),
        gl.STATIC_DRAW
    );

    // index buffer
    triangleBuffer = gl.createBuffer();

    gl.bindBuffer(
        gl.ELEMENT_ARRAY_BUFFER,
        triangleBuffer
    );

    gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new Uint16Array(indices),
        gl.STATIC_DRAW
    );

    triBufferSize = indices.length;
}


// restore original image
function restoreOriginalImage() {

    // vertex buffer
    vertexBuffer = gl.createBuffer();

    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        vertexBuffer
    );

    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(originalVertices),
        gl.STATIC_DRAW
    );

    // color buffer
    colorBuffer = gl.createBuffer();

    gl.bindBuffer(
        gl.ARRAY_BUFFER,
        colorBuffer
    );

    gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array(originalColors),
        gl.STATIC_DRAW
    );

    // index buffer
    triangleBuffer = gl.createBuffer();

    gl.bindBuffer(
        gl.ELEMENT_ARRAY_BUFFER,
        triangleBuffer
    );

    gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        new Uint16Array(originalIndices),
        gl.STATIC_DRAW
    );

    triBufferSize = originalIndices.length;
}


// space bar toggles custom image
document.addEventListener(
    "keydown",
    function(event) {

        if (event.code === "Space") {

            event.preventDefault();

            if (customMode) {
                customMode = false;
                restoreOriginalImage();
            } else {
                customMode = true;
                createCustomImage();
            }

            renderTriangles();
        }
    }
);


/* MAIN */

function main() {

    setupWebGL();
    loadTriangles();
    setupShaders();
    renderTriangles();

}
