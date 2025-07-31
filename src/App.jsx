import { Navigate, Route, Routes } from "react-router";
import Nav from "./components/Nav";
import BennettHome from "./pages/BennettHome";
import EricHome from "./pages/EricHome";
import EricPost from "./pages/EricPost";

function App() {
    return (
        <>
            <div className='min-w-screen min-h-screen h-screen w-screen bg-neutral-50 flex flex-col justify-start items-center gap-5'>
                <div className=' w-full h-auto flex flex-col justify-center items-center overflow-hidden'>
                    <Nav />

                    <Routes>
                        <Route index element={<Navigate to='/15362313' />} />
                        <Route path='15362313'>
                            <Route index element={<EricHome />} />
                            <Route path=':postId' element={<EricPost />} />
                        </Route>
                        <Route path='12153232154242' element={<BennettHome />} />
                    </Routes>
                </div>
            </div>
        </>
    );
}

export default App;
