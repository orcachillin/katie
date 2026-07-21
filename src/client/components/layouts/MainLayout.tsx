import { Children } from "@kitajs/html";
import Link from "../util/Link.js";

export function MainLayout(props: { children: Children }) {
	return (
		<div class="layout">
			<nav class="navbar">
				<a href="/" class="navbar-brand">
					nitr
				</a>
				<div class="navbar-links">
					<Link href="/contexts" get="pages.contexts">
						Contexts
					</Link>
				</div>
			</nav>
			<main id="main" class="container" hx-history-elt>
				{props.children}
			</main>
		</div>
	);
}
