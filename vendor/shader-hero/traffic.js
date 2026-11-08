// Scene: traffic — a floor of lanes running to a horizon, with pulses of light moving along them: requests going in
// toward the glow where the lanes meet, responses coming back out in a second color. Built for the server page (a band
// at the bottom of the hero, like the ocean). Lines stay one pixel wide at every depth and fade before they could
// alias near the horizon; transparent everywhere else, so the page background shows through.
({
  selector: 'canvas.traffic',
  hash: '#traffic',
  frag: `uniform vec3 req,res,grid;uniform float dark;
float h1(float n){return fract(sin(n*127.1+.7)*43758.5453);}
void main(){
vec2 uv=gl_FragCoord.xy/r;float asp=r.x/r.y;
float H=.84,d=H-uv.y,cx=abs(uv.x-.5);
// the glow where the lanes meet: the server
float glow=exp(-abs(d)*26.)*exp(-cx*cx*14.)*(.55+.45*dark);
if(d<=0.){float a=glow*.5;gl_FragColor=vec4(req*a,a);return;}
float z=.16/d,S=.075;                             // depth, and the lane spacing in world units
float lx=(uv.x-.5)*asp*z/S,li=floor(lx+.5);       // lanes are lines of constant world x
// how far one screen pixel moves lx, both ways: side lanes run almost flat on screen, so x alone would alias them
vec2 g=vec2(asp*z/(S*r.x),(uv.x-.5)*asp*z/(S*d*r.y));
float gp=length(g),dp=abs(lx-li)/gp;               // distance to the nearest lane, in screen pixels
float sharp=smoothstep(3.,10.,1./gp);              // lanes closer than a few pixels fade instead of aliasing
float line=(1.-smoothstep(.35,1.1,dp))*sharp;
float fog=exp(-z*.035)*smoothstep(0.,.18,uv.y+.02)*(1.-.65*smoothstep(.28,.5,cx)); // calmer at the far sides
// one packet train per lane: speed, spacing and direction from the lane's own hash; a few lanes stay quiet
float hh=h1(li),hk=h1(li+31.7),on=step(.3,hk);
float dir=hk>.72?-1.:1.,sp=.35+hh*.6,per=1.6+hh*2.4;
float ph=fract((z-dir*t*sp)/per+hh);
float q=dir>0.?ph:1.-ph;
float pulse=pow(q,30.)*on;
float body=(1.-smoothstep(.6,2.4,dp))*smoothstep(1.5,5.,1./gp); // a little wider than its lane
vec3 pc=dir>0.?req:res;
vec3 col=grid*line*(.28+.12*dark)+pc*pulse*body*(1.6+.6*dark)+req*glow*.6;
float a=clamp(line*(.28+.12*dark)+pulse*body*1.4+glow*.6,0.,1.)*fog+glow*.3*(1.-fog);
gl_FragColor=vec4(col*fog+req*glow*.3*(1.-fog),a);}`,
  theme(token, dark, set) {
    const acc = token('--acc'), ink = token('--ink');
    set('req', acc);
    set('res', dark ? acc.map((c, i) => c * .35 + ink[i] * .65) : acc.map((c, i) => c * .45 + ink[i] * .55));
    set('grid', dark ? ink.map((c) => c * .55) : ink.map((c) => c * .7));
    set('dark', dark ? 1 : 0);
  },
  scale: 0.75,
})
