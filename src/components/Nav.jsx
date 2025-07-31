import { NavLink } from "react-router";

export default function Nav({}) {
    return (
        <div className='w-auto h-auto flex flex-row justify-center items-center gap-5 p-4'>
            <NavLink
                to='/15362313'
                className='no-underline text-black hover:text-gray-600 text-left'
            >
                15362313
            </NavLink>
            <p>36.</p>
            <NavLink
                to='/12153232154242'
                className='no-underline text-black hover:text-gray-900 text-left'
            >
                12153232154242
            </NavLink>
        </div>
    );
}
