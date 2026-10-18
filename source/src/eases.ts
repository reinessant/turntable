import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { FLIGHT_EASE } from "./transitionTiming";

gsap.registerPlugin(CustomEase);
CustomEase.create("flightLift", FLIGHT_EASE.lift);
CustomEase.create("flightGlide", FLIGHT_EASE.glide);
CustomEase.create("flightSettle", FLIGHT_EASE.settle);
