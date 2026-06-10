window.addEventListener('DOMContentLoaded', (event) => {
	console.log("DOMContentLoaded :",)
	// var url = new URL(window.location.href);
	// var redirectUri = url.searchParams.get('redirect_uri');
	// if (redirectUri) {
	// 	localStorage.setItem('redirect_uri', redirectUri);
	// }
	const viewport = document.querySelector("meta[name=viewport]");
	viewport.setAttribute("content", viewport.content + ", height=" + window.innerHeight);
});

function cancelAuthentication() {
	let redirectUri = localStorage.getItem('redirect_uri');
	if (redirectUri) {
		window.location.replace(redirectUri + '?canceled=true');
	} else {
		window.history.go(-2);
	}
}

function show_hide_pwd() {
	var x = document.getElementById("password");
	if (x.type === "password") {
		x.type = "text";
		document.getElementById("eye-icon").classList.toggle("visible");
	} else {
		x.type = "password";
		document.getElementById("eye-icon").classList.toggle("visible");
	}
}
