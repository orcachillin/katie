import Time from "../../../util/time.js";

// follows path-to-regexp spec
export const route = "/";

// all methods are supported, just name the functions as needed
// default functions can also be used as get methods
export async function get() {
	return (
		<>
			<h2>nitr</h2>
			<p>the tiny "framework" for building high speed, data driven, server side rendered web apps</p>
		</>
	);
}
